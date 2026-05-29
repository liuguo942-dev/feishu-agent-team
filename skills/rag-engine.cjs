/**
 * RAG Engine — 本地 embedding + 向量检索
 *
 * 模型: Xenova/bge-small-zh-v1.5 (BGE 中文小模型, ~100MB)
 * 首次运行自动下载模型，后续使用本地缓存
 * embedding 缓存到 disk，文档不变不重算
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── 配置 ──────────────────────────────────────────────────────

// KB_DIR: 知识库路径，默认取 repo 同级 KnowledgeBase 目录
const KB_DIR =
  process.env.RAG_KB_DIR ||
  path.resolve(__dirname, "..", "KnowledgeBase");

// PY_KNOWLEDGE: 产品知识 JSON（优先环境变量，其次 KB_DIR 下查找）
const PY_KNOWLEDGE =
  process.env.RAG_PY_KNOWLEDGE ||
  (function () {
    var p = path.join(KB_DIR, "knowledge.json");
    return fs.existsSync(p) ? p : "";
  })();

// CACHE_FILE: embedding 缓存
const CACHE_FILE =
  process.env.RAG_CACHE_FILE ||
  path.resolve(__dirname, "..", "rag-cache.json");

const MODEL = "Xenova/bge-small-zh-v1.5";
const TOP_K = 5;

// ── 文档加载 ──────────────────────────────────────────────────

function loadMarkdownFiles(dir) {
  const chunks = [];
  if (!fs.existsSync(dir)) return chunks;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    const sections = content.split(/^## /m);

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      const lines = trimmed.split("\n");
      const title = lines[0].replace(/^#+ /, "").trim();
      const body = lines.slice(1).join("\n").trim();
      if (!body) continue;

      chunks.push({
        id: "kb:" + file + ":" + hash(title),
        source: file,
        title: title,
        content: "## " + title + "\n" + body,
      });
    }
  }
  return chunks;
}

function loadPythonKnowledge(jsonPath) {
  const chunks = [];
  if (!jsonPath || !fs.existsSync(jsonPath)) return chunks;

  const docs = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  for (const doc of docs) {
    chunks.push({
      id: "py:" + doc.id,
      source: doc.source || "Python知识库",
      title: doc.title,
      content: doc.content,
      domain: doc.domain,
      tags: doc.tags,
    });
  }
  return chunks;
}

// ── 工具 ──────────────────────────────────────────────────────

function hash(str) {
  return crypto.createHash("md5").update(str).digest("hex").slice(0, 8);
}

function cosineSimilarity(a, b) {
  var dot = 0, na = 0, nb = 0;
  for (var i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

// ── 核心 ──────────────────────────────────────────────────────

async function getEmbedder() {
  const { pipeline } = await import("@xenova/transformers");
  return pipeline("feature-extraction", MODEL);
}

async function embed(extractor, texts) {
  var results = [];
  for (var i = 0; i < texts.length; i++) {
    var output = await extractor(texts[i], {
      pooling: "mean",
      normalize: true,
    });
    results.push(Array.from(output.data));
  }
  return results;
}

async function buildIndex(extractor) {
  console.error("[RAG] 加载文档...");
  var mdChunks = loadMarkdownFiles(KB_DIR);
  var pyChunks = loadPythonKnowledge(PY_KNOWLEDGE);
  var allChunks = mdChunks.concat(pyChunks);
  console.error("[RAG] 共 " + allChunks.length + " 个文档块 (" + mdChunks.length + " MD + " + pyChunks.length + " JSON)");

  console.error("[RAG] 生成 embedding...");
  var texts = allChunks.map(function (c) { return c.content; });
  var vectors = await embed(extractor, texts);

  var index = {
    model: MODEL,
    updated: new Date().toISOString(),
    chunks: allChunks.map(function (c, i) {
      return {
        id: c.id,
        source: c.source,
        title: c.title,
        content: c.content,
        domain: c.domain,
        tags: c.tags,
        vector: vectors[i],
      };
    }),
  };

  var dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(index));
  console.error("[RAG] 索引已缓存到 " + CACHE_FILE);

  return index;
}

async function loadOrBuildIndex() {
  if (fs.existsSync(CACHE_FILE)) {
    var cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    if (cached.model === MODEL && cached.chunks && cached.chunks.length > 0) {
      console.error("[RAG] 使用缓存索引 (" + cached.chunks.length + " 块, " + cached.updated + ")");
      return cached;
    }
  }

  var extractor = await getEmbedder();
  return buildIndex(extractor);
}

// ── 公开接口 ──────────────────────────────────────────────────

async function search(query, topK) {
  if (!topK) topK = TOP_K;

  var index = await loadOrBuildIndex();
  var extractor = await getEmbedder();

  var queryVecs = await embed(extractor, [query]);
  var queryVec = queryVecs[0];

  var scored = index.chunks.map(function (chunk) {
    return {
      title: chunk.title,
      content: chunk.content,
      source: chunk.source,
      score: cosineSimilarity(queryVec, chunk.vector),
    };
  });

  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, topK);
}

async function stats() {
  if (!fs.existsSync(CACHE_FILE)) return { chunks: 0, cached: false };
  var idx = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  return {
    model: idx.model,
    chunks: idx.chunks.length,
    updated: idx.updated,
    cached: true,
  };
}

async function rebuild() {
  if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  return loadOrBuildIndex();
}

module.exports = { search: search, stats: stats, rebuild: rebuild };

// ── CLI 直接运行 ──────────────────────────────────────────────

if (require.main === module) {
  (async function () {
    var query = process.argv[2] || "退款政策";

    var st = await stats();
    console.error(JSON.stringify(st));

    console.error("\n🔍 检索: \"" + query + "\"\n");
    var results = await search(query);

    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("📄 [" + r.source + "] " + r.title + "  (相似度: " + r.score.toFixed(3) + ")");
      console.log("   " + r.content.slice(0, 200) + (r.content.length > 200 ? "..." : ""));
      console.log();
    }
  })().catch(console.error);
}
