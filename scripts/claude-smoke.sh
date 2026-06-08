#!/usr/bin/env bash
# Layer 3 smoke test: spin up a sandboxed Claude Code session with novelforge
# MCP registered project-locally, and ask it to generate a 1-chapter short
# story end-to-end. Verifies the prompts + state machine survive a real LLM.
#
# Cost note: this calls real Claude. A 1-chapter run is typically a few cents
# on Sonnet. Override with --model to use a cheaper tier.
#
# Usage:
#   bash scripts/claude-smoke.sh                  # default: 1 chapter, ~600 words target
#   bash scripts/claude-smoke.sh --chapters 2     # longer
#   bash scripts/claude-smoke.sh --model claude-haiku-4.5
set -euo pipefail

CHAPTERS=1
MODEL=""
MAX_TURNS=30
while [ $# -gt 0 ]; do
  case "$1" in
    --chapters) CHAPTERS="$2"; shift 2 ;;
    --model)    MODEL="$2"; shift 2 ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SMOKE="$(mktemp -d -t nf-claude-XXXXXX)"
WORKSPACE="$SMOKE/workspace"
mkdir -p "$WORKSPACE"

echo "smoke root  : $SMOKE"
echo "workspace   : $WORKSPACE"

( cd "$ROOT_DIR" && npm run build > /dev/null 2>&1 || true )

# Project-local .mcp.json (Claude Code picks it up via --mcp-config)
cat > "$SMOKE/.mcp.json" <<JSON
{
  "mcpServers": {
    "novelforge": {
      "command": "node",
      "args": ["$ROOT_DIR/dist/src/mcp/server.js"],
      "env": { "NOVELFORGE_WORKSPACE": "$WORKSPACE" }
    }
  }
}
JSON

# Build the prompt in a separate file to avoid heredoc/quoting headaches.
PROMPT_FILE="$SMOKE/prompt.txt"
cat > "$PROMPT_FILE" <<'PROMPT'
You have access to an MCP server named "novelforge". Use ONLY its tools. Do not write prose into the chat directly.

Goal: produce a tiny test novel of __CHAPTERS__ chapter(s), then stop. Keep target word counts tiny so this finishes fast.
- Genre: xianxia (Chinese cultivation, output Chinese prose)
- Premise: a mortal teenager awakens an ancient sword spirit and is forced to leave his ancestral home

Steps you must perform autonomously, in order:
1. Call start_novel_project with prompt="A teenager awakens an ancient sword spirit", targetChapters=__CHAPTERS__, language="zh-CN".
2. From the response, take the projectPath value.
3. Loop: read next.instruction and next.expectedFormat. Produce the requested artifact (JSON or Markdown). Call submit_step_result with the projectPath and the step name from next.currentStep.
4. When you submit the chapter architecture (JSON), include "targetWords": 600 for every chapter in the chapters array.
5. Continue the loop until the workflow returns currentStep equal to complete.
6. After complete, call list_threads on the projectPath and call retrieve with query="kunwu" topK=4 to verify indexing.
7. End your turn with one short JSON object on its own line containing: projectPath, chaptersWritten, threadCount, retrieveHitCount. Nothing else.

Do not ask clarifying questions. Default to reasonable choices. Be terse in chat.
PROMPT

# Substitute __CHAPTERS__ — keeps the heredoc literal-safe above.
sed -i.bak "s/__CHAPTERS__/$CHAPTERS/g" "$PROMPT_FILE" && rm -f "$PROMPT_FILE.bak"

PROMPT_BODY="$(cat "$PROMPT_FILE")"

OUT="$SMOKE/claude-output.json"
RAW="$SMOKE/claude-raw.txt"

MODEL_ARGS=()
if [ -n "$MODEL" ]; then
  MODEL_ARGS=(--model "$MODEL")
fi

echo "running claude (max-turns=$MAX_TURNS, model=${MODEL:-default}, chapters=$CHAPTERS)..."
cd "$SMOKE"
set +e
if [ "${#MODEL_ARGS[@]}" -gt 0 ]; then
  claude -p "$PROMPT_BODY" \
    --strict-mcp-config \
    --mcp-config "$SMOKE/.mcp.json" \
    --max-turns "$MAX_TURNS" \
    --output-format json \
    --permission-mode bypassPermissions \
    "${MODEL_ARGS[@]}" \
    > "$OUT" 2> "$RAW"
else
  claude -p "$PROMPT_BODY" \
    --strict-mcp-config \
    --mcp-config "$SMOKE/.mcp.json" \
    --max-turns "$MAX_TURNS" \
    --output-format json \
    --permission-mode bypassPermissions \
    > "$OUT" 2> "$RAW"
fi
EXIT=$?
set -e

if [ $EXIT -ne 0 ]; then
  echo "claude exited $EXIT"
  echo "--- stderr tail ---"
  tail -40 "$RAW"
  echo "--- stdout tail ---"
  tail -20 "$OUT" || true
  exit $EXIT
fi

echo "claude exited 0"
echo
echo "=== claude final text ==="
jq -r '.result // .response // "(no result key)"' "$OUT" 2>/dev/null | head -40 || cat "$OUT" | head -40

echo
echo "=== artifact check ==="
PROJECT_DIR=$(find "$WORKSPACE/novels" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)
if [ -z "$PROJECT_DIR" ]; then
  echo "no project directory under $WORKSPACE/novels"
  exit 1
fi
echo "project: $PROJECT_DIR"

FAIL=0
require() { [ -e "$1" ] && echo "  ok $1" || { echo "  MISSING $1"; FAIL=1; }; }
require "$PROJECT_DIR/agent-state.json"
require "$PROJECT_DIR/novel.json"
require "$PROJECT_DIR/story-bible.md"
require "$PROJECT_DIR/architecture/chapters.json"
require "$PROJECT_DIR/chapters/001.md"
require "$PROJECT_DIR/memory/chapter-001.json"
require "$PROJECT_DIR/threads.json"

STATE_STEP=$(jq -r '.currentStep' "$PROJECT_DIR/agent-state.json")
echo "  current step: $STATE_STEP"

CHAPTER_WC=$(wc -m < "$PROJECT_DIR/chapters/001.md" 2>/dev/null || echo 0)
echo "  chapter 1 char count: $CHAPTER_WC"

THREADS=$(jq '.threads | length' "$PROJECT_DIR/threads.json" 2>/dev/null || echo 0)
echo "  threads aggregated: $THREADS"

if [ "$FAIL" -ne 0 ]; then
  echo "artifact check failed"
  exit 1
fi

echo
echo "smoke kept at: $SMOKE  (inspect or rm -rf)"
echo
echo "=== chapter 1 preview ==="
head -20 "$PROJECT_DIR/chapters/001.md"
echo
echo "OK Claude Code headless smoke pass"
