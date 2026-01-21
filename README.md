# QQ + LLM 聊天机器人（NapCatQQ）

一个最小可用的 QQ 聊天机器人骨架：
- NapCatQQ（OneBot 消息流）接入与发送
- 群聊/私聊分流与触发策略（@ / 关键词 / 全量）
- 记忆系统（短期对话窗口 + 长期记忆）
- 最小 RAG（本地知识库切片 + 检索）
- MCP（可选，对接外部工具）

## 运行前提

- Node.js 18+
- 已启动 NapCatQQ，并开启 OneBot WebSocket 上报与 HTTP API

## 安装

```bash
npm install
```

## 配置（环境变量）

推荐做法：复制 `.env.example` 为 `.env`，然后只改你自己的值。

- `NAPCAT_HTTP_URL` NapCat HTTP API 基址（默认 `http://127.0.0.1:3000`）
- `NAPCAT_WS_URL` NapCat WebSocket 上报地址（默认 `ws://127.0.0.1:3001`）
- `NAPCAT_ACCESS_TOKEN`（可选）
- `BOT_QQ_ID`（可选，不填则从事件的 `self_id` 自动识别）

- `LLM_BASE_URL` OpenAI 兼容网关（默认 `https://api.openai.com`，可带或不带 `/v1`）
- `LLM_API_KEY` OpenAPI Key（注意是 `=` 赋值，不要写成中文冒号）
- `LLM_MODEL`（默认 `gpt-4o-mini`）
- `LLM_TEMPERATURE`（默认 `0.3`）

- `GROUP_REPLY_MODE`（`mention`/`keyword`/`all`，默认 `mention`）
- `GROUP_KEYWORDS`（默认 `["机器人"]`，支持 JSON 数组或逗号分隔）
- `MAX_SHORT_MEMORY_TURNS`（默认 `20`）

示例（PowerShell）：

```powershell
$env:LLM_BASE_URL="https://api.deepseek.com/v1"
$env:LLM_API_KEY="sk-xxxx"
$env:LLM_MODEL="deepseek-chat"
$env:GROUP_REPLY_MODE="keyword"
$env:GROUP_KEYWORDS='["机器人","bot","小助手"]'
```

## 诊断（建议先跑一次）

检查 NapCat HTTP/WS 是否能连上：

```bash
npm run doctor
```

## 启动

开发模式：

```bash
npm run dev
```

生产模式：

```bash
npm run build
npm start
```

## 记忆与知识库

- 短期记忆：自动保存最近对话窗口（本地 `data/messages.jsonl`）
- 长期记忆：用指令写入
  - 私聊：`/记住 你的内容`
  - 群聊：`@机器人 /记住 你的内容`
- 知识库：把 `md/txt` 放到 `knowledge/`，然后运行

```bash
npm run ingest
```

默认写入作用域 `global`，群/私聊都会检索到（你也可以扩展为群专属作用域）。

## MCP（外部工具，可选）

项目使用 `mcp.servers.json` 来启动/连接 MCP Server（一个 server 进程可以提供多个工具）。启动时会对每个 server 执行 `listTools` 自动发现其工具列表，所以配置文件按“server 维度”组织是 MCP 的常见方式。

示例：

```json
{
  "servers": [
    {
      "name": "my-tools",
      "command": "node",
      "args": ["dist/mcp/servers/my-tools.js"],
      "enabled": true,
      "tools": {
        "weather_query": true,
        "web_search": true
      }
    }
  ]
}
```

- `enabled`: 是否启用该 server
- `tools`: 可选，按工具名开关；不写则默认全部启用，写 `false` 可禁用单个工具

