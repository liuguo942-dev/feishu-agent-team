/**
 * OpenClaw Skill: RAG 知识库语义检索
 *
 * Collector Agent 调用此 Skill 替代 bash type 读文件
 * 用法: node skills/skill-rag-search.cjs "用户问题"
 * 输出: JSON 格式检索结果
 */

const { search, stats } = require("./rag-engine.cjs");

async function main() {
  const query = process.argv[2];

  if (!query) {
    console.log(JSON.stringify({ error: "请提供查询内容" }));
    process.exit(1);
  }

  const st = await stats();
  console.error("[RAG] 索引: " + st.chunks + " 块 | 模型: " + st.model);

  const results = await search(query);

  const formatted = results.map(function (r) {
    return {
      source: r.source,
      title: r.title,
      content: r.content,
      relevance: Math.round(r.score * 100),
    };
  });

  if (formatted.length > 0 && formatted[0].relevance > 20) {
    console.error(
      "[RAG] 最佳匹配: " + formatted[0].title + " (" + formatted[0].relevance + "%)"
    );
  } else {
    console.error("[RAG] 未找到高相关文档");
  }

  console.log(JSON.stringify(formatted, null, 2));
}

main().catch(function (e) {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
