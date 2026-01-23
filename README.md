# QQ LLM Bot (NapCat / OneBot)

[中文说明](README.zh-CN.md)

A practical QQ bot built on NapCat (OneBot), powered by an OpenAI-compatible LLM. Includes MCP tools, reminders, and daily usage stats (vision is provided via MCP).

## Features

- NapCatQQ (OneBot) receive/send
- Group routing modes: mention / keyword / all
- Group follow-up window after mention/keyword (keep replying for a few turns without re-mention)
- Reminders: create/list/cancel reminders in private or group chat
- Optional MCP tools (external tool servers)
- Daily per-user usage stats (tokens / calls / tool calls) saved to CSV

## Project Layout

- `src/` TypeScript source code
- `dist/` Build output (`npm run build`)
- `data/` Runtime data (notes, reminders, stats). Ignored by git.
- `prompts/` System prompt files
- `knowledge/` Knowledge examples / RAG resources
- `.env` Local config (ignored by git) and `.env.example` template

## Requirements

- Node.js 18+
- NapCatQQ running with OneBot WebSocket events + HTTP API enabled

## Quick Start

```bash
npm install
cp .env.example .env
npm run doctor
npm run dev
```

## Configuration

Copy `.env.example` to `.env` and only change your own values.

### NapCat / QQ

- `NAPCAT_HTTP_URL` NapCat HTTP API base URL
- `NAPCAT_WS_URL` NapCat WebSocket events URL
- `NAPCAT_HTTP_TOKEN` / `NAPCAT_WS_TOKEN` optional tokens
  - If you do not set tokens in `.env`, the bot may auto-load them from local NapCat OneBot config (when available).
- `BOT_QQ_ID` optional (auto-detected from `self_id` if unset)
- `BOT_NAME` bot nickname (default: `小助手`)

### LLM

- `LLM_BASE_URL` OpenAI-compatible gateway base URL
- `LLM_API_KEY` API key
- `LLM_MODEL` model name
- `LLM_TEMPERATURE` sampling temperature (default: `0.3`)

## Scripts

```bash
npm run dev     # run bot in dev mode
npm run doctor  # check NapCat HTTP/WS connectivity
npm run build   # compile to dist/
npm run start   # run dist/ output
npm run test    # run tests
```

### Group Reply Modes

- `GROUP_REPLY_MODE`:
  - `mention` (default): reply when mentioned; also replies on nickname/keywords if configured
  - `keyword`: reply when any keyword appears
  - `all`: reply to all group messages
- `GROUP_KEYWORDS` keywords array (JSON) or comma-separated list
- `GROUP_FOLLOWUP_TURNS` number of follow-up messages to handle after a trigger (default: `4`)
- `GROUP_FOLLOWUP_TTL_MS` follow-up window TTL in ms (default: `120000`)

### Usage Stats (Daily CSV)

- The bot records per-user daily usage statistics:
  - LLM calls and tokens (prompt/completion/total) if the gateway returns `usage`
  - Tool call counts (including MCP and builtin tools)
- Files are written to:
  - `STATS_DIR/YYYY-MM-DD.csv` (recommended) or `DATA_DIR/stats/YYYY-MM-DD.csv` by default
- Query in chat:
  - `token统计` / `今日统计` / `我的统计` / `今日用量` / `我的用量`

### System Prompt

Choose one:

- `SYSTEM_PROMPT_FILE=prompts/system.txt` (recommended)
- `SYSTEM_PROMPT=...`

## MCP (Optional External Tools)

This project uses `mcp.servers.json` to start/connect MCP servers. One server can expose multiple tools and the bot discovers them via `listTools`.

Example:

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

- `enabled`: enable/disable a whole server
- `tools`: optional. Two modes:
  - Allowlist: if any value is `true`, only tools marked `true` are enabled
  - Denylist: if there is no `true`, all tools are enabled by default; set `false` to disable a specific tool

## Security Notes

- Never commit `.env` or any real API keys. This repo ignores `.env` and `.env.*` by default and keeps `.env.example`.
- If you accidentally pushed a key to GitHub, rotate it immediately and rewrite history if needed.
- Local NapCat bundles (`NapCat.Shell.Windows.Node/`) and runtime data (`data/`) are ignored to avoid leaking tokens and chat logs.

## Troubleshooting

- HTTP shows `403 token verify failed`: set `NAPCAT_HTTP_TOKEN` correctly.
- Bot receives messages but does not reply: check routing mode (`GROUP_REPLY_MODE`) and whether the message triggered mention/keyword logic.

## Credits

- NapCatQQ (OneBot / NTQQ protocol-side): https://github.com/NapNeko/NapCatQQ
