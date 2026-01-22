# QQ + LLM 聊天机器人（NapCat / OneBot）

[English README](README.md)

一个最小可用的 QQ 机器人骨架：基于 NapCatQQ（OneBot），使用 OpenAI 兼容网关的大模型。包含短期/长期记忆、轻量 RAG，可选识图（多模态）与 MCP 外部工具。

## 功能

- NapCatQQ（OneBot）收发消息
- 群聊触发方式：@ / 关键词 / 全量
- 记忆：短期上下文窗口 + 指令写入长期记忆
- RAG：本地知识库切片 + 检索
- 可选识图（OpenAI 兼容多模态网关）
- 可选 MCP 工具（外部工具 server）

## 运行前提

- Node.js 18+
- 已启动 NapCatQQ，并开启 OneBot WebSocket 上报与 HTTP API

## 快速开始

```bash
npm install
cp .env.example .env
npm run doctor
npm run dev
```

## 配置（环境变量）

推荐做法：复制 `.env.example` 为 `.env`，然后只改你自己的值（不要提交 `.env`）。

### NapCat / QQ

- `NAPCAT_HTTP_URL` NapCat HTTP API 地址
- `NAPCAT_WS_URL` NapCat WebSocket 上报地址
- `NAPCAT_HTTP_TOKEN` / `NAPCAT_WS_TOKEN`（可选）
- `BOT_QQ_ID`（可选，不填则从事件 `self_id` 自动识别）
- `BOT_NAME` 机器人昵称（默认：`小助手`）

### 大模型（LLM）

- `LLM_BASE_URL` OpenAI 兼容网关地址
- `LLM_API_KEY` key
- `LLM_MODEL` 模型名
- `LLM_TEMPERATURE` 温度（默认 `0.3`）

### 群聊触发

- `GROUP_REPLY_MODE`：
  - `mention`（默认）：被 @ 时回复；同时支持昵称/关键字触发（如果配置了 `BOT_NAME`/`GROUP_KEYWORDS`）
  - `keyword`：命中关键字就回复
  - `all`：群里所有消息都回复
- `GROUP_KEYWORDS` 关键字列表（JSON 数组或逗号分隔）

### 上下文窗口

- `MAX_SHORT_MEMORY_TURNS` 短期上下文窗口大小（默认 `20`）

### 系统提示词

二选一：

- `SYSTEM_PROMPT_FILE=prompts/system.txt`（推荐）
- `SYSTEM_PROMPT=...`

### 识图（可选）

- `VISION_BASE_URL` OpenAI 兼容多模态网关
- `VISION_API_KEY` key
- `VISION_MODEL` 多模态模型名（例如 `qwen3-vl-plus`）

## 记忆与知识库

- 短期记忆：保存在 `data/messages.jsonl`
  - 私聊：按 `userId` 隔离上下文
  - 群聊：按 `groupId + userId` 隔离上下文（避免群内不同人的上下文互相污染）
- 长期记忆：
  - 私聊：`/记住 你的内容`
  - 群聊：`@机器人 /记住 你的内容`
- 知识库：把 `md/txt` 放到 `knowledge/`，然后运行

```bash
npm run ingest
```

## MCP（可选外部工具）

项目使用 `mcp.servers.json` 启动/连接 MCP Server。一个 server 可以提供多个工具，机器人启动时会通过 `listTools` 自动发现工具列表。

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

- `enabled`：启用/禁用整个 server
- `tools`：可选，按工具名开关；不写默认全启用，写 `false` 可禁用单个工具

## 安全提示

- 不要提交 `.env` 或任何真实 key。本仓库默认忽略 `.env` / `.env.*`，并保留 `.env.example`。
- 如果不小心把 key 推到了 GitHub，请立刻轮换/重置，并视情况清理历史记录。
- 本地 NapCat 包（`NapCat.Shell.Windows.Node/`）和运行数据（`data/`）已默认忽略，避免泄露 token 与聊天记录。
- 不要用 `/记住` 写入“忽略系统提示词/泄露密钥/执行隐藏指令”等内容；机器人会把长期记忆当作不可信资料处理，但仍建议保持记忆内容干净。

## 致谢

- NapCatQQ（OneBot / NTQQ 协议端）：https://github.com/NapNeko/NapCatQQ
