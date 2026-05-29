# 智能客服工单系统

基于 OpenClaw 多 Agent 框架搭建的智能客服系统，支持意图分类、**RAG 语义知识检索**、自动回复、工单流转。

## 架构

```
用户消息 → 客服调度(意图分类+调度) → 信息采集(信息提取+RAG语义检索) → 工单处理(自动回复/工单生成)
                                            ↓
                                    RAG Skill（BGE 向量检索）
```

### 3 个 Agent

| Agent | 角色 | 职责 |
|-------|------|------|
| 客服调度 | 客服总调度 | 6 类意图分类(technical/account/order/logistics/after_sales/complaint)、紧急度判断、分发调度 |
| 信息采集 | 信息采集员 | 提取用户结构化信息、**RAG 语义检索本地知识库** |
| 工单处理 | 工单处理员 | 知识库命中时直接回复、未命中时生成工单转人工 |

## 核心流程

1. **意图分类**：客服调度分析用户消息，判断类别和紧急度
2. **RAG 语义检索**：信息采集通过 BGE 中文向量模型，对用户问题做语义检索，找到知识库中最相关的文档片段
3. **三级处理策略**：
   - 知识库有答案 → 工单处理直接回复
   - 知识库无答案 → 自动建单兜底
   - 高紧急/投诉 → 直转人工

## RAG 知识库

### 为什么用 RAG

传统关键词匹配："耳机保修"搜不到"质保说明"  
RAG 语义检索："耳机保修"能命中"耳机质保说明"，因为向量语义相近

### 技术实现

- 文档分块：按 `##` 标题拆分 Markdown 文档
- 向量模型：`bge-small-zh-v1.5`（BAAI 中文向量模型，本地运行）
- 相似度：余弦相似度排序，返回 Top-5
- 缓存：embedding 向量缓存到本地，文档不变不重算

### 使用方式

```bash
# 首次运行（自动下载模型 ~100MB，只一次）
cd skills && npm install @xenova/transformers

# 测试检索
node rag-engine.cjs "耳机保修多久"

# Agent 调用
node skill-rag-search.cjs "我要退款怎么操作"
```

## 项目结构

```
├── README.md
├── openclaw.json            # OpenClaw 配置（需替换 API Key）
├── KnowledgeBase/           # 本地知识库
│   ├── 常见问题.md           # 账号/订单/产品 FAQ
│   ├── 技术故障排查.md       # 错误码/页面故障/上传问题
│   └── 退款政策.md           # 退款规则和流程
├── agents/                  # Agent 角色定义
│   ├── 客服调度/SOUL.md
│   ├── 信息采集/
│   │   ├── SOUL.md
│   │   └── TOOLS.md
│   └── 工单处理/SOUL.md
└── skills/                  # 自定义 Skill
    ├── rag-engine.cjs       # RAG 核心引擎
    └── skill-rag-search.cjs # RAG 检索 Skill 封装
```

## 使用方式

1. 安装 OpenClaw：`npm install -g openclaw`
2. 安装 RAG 依赖：`cd skills && npm install @xenova/transformers`
3. 构建索引（首次）：`node skills/rag-engine.cjs`
4. 启动 Gateway：`openclaw gateway`
5. 将本项目文件放入 `~/.openclaw/` 目录
6. 通过飞书或 ClickClack 发送消息测试

## 测试用例

```
# 知识库可回答（RAG 语义匹配）
"怎么重置密码？"              → RAG检索命中 → 直接给出重置步骤
"网站报 502 错误"            → RAG检索命中 → 给出排查方案  
"耳机保修多久"               → RAG语义匹配"耳机质保说明" → 返回12个月保修
"我要退款，订单号 XXX"       → RAG检索命中 → 告知退款政策

# 需转人工
"你们这产品太差了，投诉"     → 高紧急 → 直接生成投诉工单
```

## 技术栈

OpenClaw · DeepSeek V4 · BGE Embedding / Transformers.js · Prompt 工程 · RAG

## License

MIT
