# NovelForge Agent

NovelForge Agent is a local-first novel workflow kit. It provides an Agent Core plus MCP and CLI adapters. The host assistant supplies all language model output; this package manages workflow, state, validation, context, and Markdown/JSON files.

## Install

```bash
npm install
npm run build
```

## CLI Smoke Test

```bash
node dist/src/cli/index.js start --prompt "写一本赛博修仙小说" --chapters 3
```

## MCP Entrypoint

```bash
node dist/src/mcp/server.js
```

Set `NOVELFORGE_WORKSPACE` to choose the workspace root.

Example MCP command:

```bash
NOVELFORGE_WORKSPACE=/path/to/workspace node /path/to/novelforge-agent/dist/src/mcp/server.js
```

## Core Principle

The MCP adapter does not call an AI model. Claude Code, Codex CLI, or another MCP host writes the prose and structured JSON. NovelForge Agent returns instructions, validates submitted content, saves files, and advances the workflow.
