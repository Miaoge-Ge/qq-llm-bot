# QQ LLM Bot (NapCat / OneBot)

[中文说明](README.zh-CN.md)

A minimal QQ bot skeleton built on NapCat (OneBot), powered by an OpenAI-compatible LLM. Includes short/long memory, lightweight RAG, optional vision, and MCP tools.

## Features

- NapCatQQ (OneBot) receive/send
- Group routing modes: mention / keyword / all
- Memory: short context window + long-term memory via command
- RAG: local knowledge ingestion + retrieval
- Optional vision (multimodal) via OpenAI-compatible gateway
- Optional MCP tools (external tool servers)

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
- `BOT_QQ_ID` optional (auto-detected from `self_id` if unset)
- `BOT_NAME` bot nickname (default: `小助手`)

### LLM

- `LLM_BASE_URL` OpenAI-compatible gateway base URL
- `LLM_API_KEY` API key
- `LLM_MODEL` model name
- `LLM_TEMPERATURE` sampling temperature (default: `0.3`)

### Group Reply Modes

- `GROUP_REPLY_MODE`:
  - `mention` (default): reply when mentioned; also replies on nickname/keywords if configured
  - `keyword`: reply when any keyword appears
  - `all`: reply to all group messages
- `GROUP_KEYWORDS` keywords array (JSON) or comma-separated list

### Context Window

- `MAX_SHORT_MEMORY_TURNS` short context window size (default: `20`)

### System Prompt

Choose one:

- `SYSTEM_PROMPT_FILE=prompts/system.txt` (recommended)
- `SYSTEM_PROMPT=...`

### Vision (Optional)

- `VISION_BASE_URL` OpenAI-compatible multimodal gateway
- `VISION_API_KEY` key
- `VISION_MODEL` multimodal model name (e.g. `qwen3-vl-plus`)

## Memory & Knowledge Base

- Short memory: stored in `data/messages.jsonl`
- Long memory:
  - Private chat: `/记住 your content`
  - Group chat: `@bot /记住 your content`
- Knowledge base:

```bash
npm run ingest
```

## MCP (Optional External Tools)

This project uses `mcp.servers.json` to start/connect MCP servers. One server can expose multiple tools and the bot discovers them via `listTools`.

Example:

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

- `enabled`: enable/disable a whole server
- `tools`: optional per-tool toggles; omit to enable all; set `false` to disable a specific tool

## Security Notes

- Never commit `.env` or any real API keys. This repo ignores `.env` and `.env.*` by default and keeps `.env.example`.
- If you accidentally pushed a key to GitHub, rotate it immediately and rewrite history if needed.
- Local NapCat bundles (`NapCat.Shell.Windows.Node/`) and runtime data (`data/`) are ignored to avoid leaking tokens and chat logs.

## Credits

- NapCatQQ (OneBot / NTQQ protocol-side): https://github.com/NapNeko/NapCatQQ

