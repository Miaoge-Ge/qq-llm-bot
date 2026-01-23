# QQ + LLM 聊天机器人（NapCat / OneBot）

[English README](README.md)

一个实用的 QQ 机器人：基于 NapCatQQ（OneBot），使用 OpenAI 兼容网关的大模型。包含 MCP 外部工具、定时提醒、每日用量统计等功能（识图作为 MCP 工具提供）。

## 功能

- NapCatQQ（OneBot）收发消息
- 群聊触发方式：@ / 关键词 / 全量
- 群聊跟进窗口：被 @ 或命中关键词后，可连续回复若干句（无需每句都 @）
- 定时提醒：支持群聊/私聊创建、查看、取消
- 可选 MCP 工具（外部工具 server）
- 每日用量统计：按人统计 tokens/次数/工具调用次数，并落盘为 CSV

## 目录结构

- `src/` TypeScript 源码
- `dist/` 构建产物（`npm run build`）
- `data/` 运行数据（笔记、提醒、统计等），默认已在 gitignore 中忽略
- `prompts/` 系统提示词文件
- `knowledge/` 知识库示例 / RAG 资源
- `.env` 本地配置（不要提交）与 `.env.example` 配置模板

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
  - 如果 `.env` 里没填 token，程序会在本机环境可用时尝试从 NapCat OneBot 配置中自动读取。
- `BOT_QQ_ID`（可选，不填则从事件 `self_id` 自动识别）
- `BOT_NAME` 机器人昵称（默认：`小助手`）

### 大模型（LLM）

- `LLM_BASE_URL` OpenAI 兼容网关地址
- `LLM_API_KEY` key
- `LLM_MODEL` 模型名
- `LLM_TEMPERATURE` 温度（默认 `0.3`）

## 常用命令

```bash
npm run dev     # 开发模式运行
npm run doctor  # 检查 NapCat HTTP/WS 连通性
npm run build   # 编译到 dist/
npm run start   # 运行 dist/ 产物
npm run test    # 运行测试
```

### 群聊触发

- `GROUP_REPLY_MODE`：
  - `mention`（默认）：被 @ 时回复；同时支持昵称/关键字触发（如果配置了 `BOT_NAME`/`GROUP_KEYWORDS`）
  - `keyword`：命中关键字就回复
  - `all`：群里所有消息都回复
- `GROUP_KEYWORDS` 关键字列表（JSON 数组或逗号分隔）
- `GROUP_FOLLOWUP_TURNS` 跟进窗口最多连续回复的句数（默认：`4`）
- `GROUP_FOLLOWUP_TTL_MS` 跟进窗口超时时间（毫秒，默认：`120000`）

### 用量统计（每日 CSV）

- 机器人会按人、按天记录用量统计：
  - LLM 调用次数与 tokens（prompt/completion/total；前提是网关返回 `usage`）
  - 工具调用次数（包含 MCP 与内置工具）
- 文件保存位置：
  - 推荐：`STATS_DIR/YYYY-MM-DD.csv`；默认：`DATA_DIR/stats/YYYY-MM-DD.csv`
- 在聊天中查询：
  - `token统计` / `今日统计` / `我的统计` / `今日用量` / `我的用量`

### 系统提示词

二选一：

- `SYSTEM_PROMPT_FILE=prompts/system.txt`（推荐）
- `SYSTEM_PROMPT=...`

## MCP（可选外部工具）

项目使用 `mcp.servers.json` 启动/连接 MCP Server。一个 server 可以提供多个工具，机器人启动时会通过 `listTools` 自动发现工具列表。

示例：

```json
{
  "servers": [
    {
      "name": "tools",
      "command": "node",
      "args": ["dist/mcp/servers/tools.js"],
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
- `tools`：可选。两种模式：
  - 允许列表：只要出现任意 `true`，则只启用标记为 `true` 的工具
  - 禁用列表：如果没有任何 `true`，则默认全启用，写 `false` 可禁用单个工具

## 安全提示

- 不要提交 `.env` 或任何真实 key。本仓库默认忽略 `.env` / `.env.*`，并保留 `.env.example`。
- 如果不小心把 key 推到了 GitHub，请立刻轮换/重置，并视情况清理历史记录。
- 本地 NapCat 包（`NapCat.Shell.Windows.Node/`）和运行数据（`data/`）已默认忽略，避免泄露 token 与聊天记录。
- 不要把“忽略系统提示词/泄露密钥/执行隐藏指令”等内容写进任何持久化数据文件；机器人会把外部内容当作不可信资料处理，但仍建议保持数据干净。

## 排障

- HTTP 报 `403 token verify failed`：检查 `NAPCAT_HTTP_TOKEN` 是否正确。
- 能收到消息但不回复：检查 `GROUP_REPLY_MODE` 以及消息是否满足 @/关键词触发规则。

## 致谢

- NapCatQQ（OneBot / NTQQ 协议端）：https://github.com/NapNeko/NapCatQQ
