#!/usr/bin/env bash
# End-to-end test: drive the full 8-step workflow via the CLI using deterministic
# fixtures. No LLM involved. Verifies state machine, persistence, BM25 index, and
# foreshadow aggregation.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq is required (brew install jq / apt install jq)"
  exit 1
fi

NF="node $ROOT_DIR/dist/src/cli/index.js"
FIX="$ROOT_DIR/fixtures"
WORK="$(mktemp -d -t nf-e2e-XXXXXX)"
trap "rm -rf $WORK" EXIT
cd "$WORK"

step() { printf "\n\033[36m▸ %s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗ %s\033[0m\n" "$1"; exit 1; }

# ---- 1. start ----
step "1. start_novel_project"
$NF start --prompt "凡人觉醒上古剑灵的修真故事" --chapters 2 --output novels > "$WORK/start.json"
PROJECT="$(jq -r '.state.projectPath' "$WORK/start.json")"
[ -n "$PROJECT" ] && [ -d "$PROJECT" ] || fail "project path missing or not created"
ok "project at $PROJECT"

# ---- 2. novel_metadata ----
step "2. submit novel_metadata"
$NF submit "$PROJECT" --step novel_metadata --file $FIX/novel.json | jq -e '.validation.ok == true' >/dev/null \
  || fail "novel_metadata not accepted"
[ -f "$PROJECT/novel.json" ] || fail "novel.json not written"
ok "novel.json saved"

# ---- 3. story_bible ----
step "3. submit story_bible"
$NF submit "$PROJECT" --step story_bible --file $FIX/bible.md | jq -e '.validation.ok == true' >/dev/null \
  || fail "story_bible not accepted"
[ -f "$PROJECT/story-bible.md" ] || fail "story-bible.md not written"
ok "story-bible.md saved + indexed"

# ---- 4. architecture ----
step "4. submit architecture (with targetWords / endHookFocus / povCharacter)"
$NF submit "$PROJECT" --step architecture --file $FIX/architecture.json | jq -e '.validation.ok == true' >/dev/null \
  || fail "architecture not accepted"
[ -f "$PROJECT/architecture/chapters.json" ] || fail "chapters.json not written"
HAS_TARGET=$(jq '[.[] | select(.targetWords == 1500)] | length' "$PROJECT/architecture/chapters.json")
[ "$HAS_TARGET" -ge 2 ] || fail "targetWords field not preserved"
ok "architecture saved with v0.2 fields"

# ---- 5. chapter 1 + memory 1 ----
step "5. chapter 1 + memory_card 1 (with threadActions)"
$NF submit "$PROJECT" --step chapter --file $FIX/ch-1.md | jq -e '.validation.ok == true' >/dev/null \
  || fail "chapter 1 not accepted"
[ -f "$PROJECT/chapters/001.md" ] || fail "chapters/001.md missing"
$NF submit "$PROJECT" --step memory_card --file $FIX/mem-1.json | jq -e '.validation.ok == true' >/dev/null \
  || fail "memory 1 not accepted"
[ -f "$PROJECT/memory/chapter-001.json" ] || fail "memory/chapter-001.json missing"

# Threads should now have 3 planted threads
THREAD_COUNT=$($NF threads "$PROJECT" | jq 'length')
[ "$THREAD_COUNT" -eq 3 ] || fail "expected 3 threads, got $THREAD_COUNT"
ok "chapter 1 + memory 1 saved, 3 threads planted"

# ---- 6. chapter 2 + memory 2 (uses retrieve + threads in context) ----
step "6. verify chapter_generation context for chapter 2 includes threads + retrieval"
CONTEXT=$($NF context "$PROJECT" --purpose chapter_generation --chapter 2)
echo "$CONTEXT" | grep -q "Active Foreshadow Threads" || fail "active threads not injected"
echo "$CONTEXT" | grep -q "Retrieved Relevant Snippets" || fail "BM25 retrieval not injected"
ok "context contains threads + retrieval snippets"

step "7. chapter 2 + memory_card 2"
$NF submit "$PROJECT" --step chapter --file $FIX/ch-2.md | jq -e '.validation.ok == true' >/dev/null \
  || fail "chapter 2 not accepted"
$NF submit "$PROJECT" --step memory_card --file $FIX/mem-2.json | jq -e '.validation.ok == true' >/dev/null \
  || fail "memory 2 not accepted"

# Should now have an additional 2 planted + 1 building action
BUILDING=$($NF threads "$PROJECT" --status building | jq 'length')
[ "$BUILDING" -ge 1 ] || fail "expected at least 1 thread in 'building' after chapter 2"
ok "chapter 2 + memory 2 saved, thread lifecycle progressed"

# ---- 7. continuity_review (closes loop) ----
step "8. continuity_review"
FINAL=$($NF submit "$PROJECT" --step continuity_review --file $FIX/continuity.json)
echo "$FINAL" | jq -e '.validation.ok == true and .state.currentStep == "complete"' >/dev/null \
  || fail "continuity_review did not complete the workflow"
ok "workflow reached 'complete'"

# ---- 8. retrieval smoke ----
step "9. retrieve smoke: '昆吾'"
HITS=$($NF retrieve "$PROJECT" --query "昆吾" --top-k 8 | jq '.hits | length')
[ "$HITS" -ge 2 ] || fail "expected ≥2 hits for '昆吾', got $HITS"
ok "$HITS hits returned"

# ---- 9. v0.2 ops: fork, amend_bible, redo, delete_chapter ----
step "10. fork_project"
FORK_OUT=$($NF fork "$PROJECT" --label "branch-a")
FORK_PATH=$(echo "$FORK_OUT" | jq -r '.newProjectPath')
[ -d "$FORK_PATH" ] && [ -f "$FORK_PATH/chapters/001.md" ] || fail "fork did not copy chapter file"
ok "fork at $FORK_PATH"

step "11. amend_story_bible on the fork"
AMENDED="# 故事圣经 v2\n\n## 核心人物\n- 陈青云：少年剑修，已确认家族灭门源于元婴境前辈。\n\n## 世界规则\n- 元婴境以上禁止干涉凡间。\n"
TMP_BIBLE="$WORK/new-bible.md"
printf "$AMENDED" > "$TMP_BIBLE"
$NF amend-bible "$FORK_PATH" --file "$TMP_BIBLE" --reason "对齐灭门真相" | jq -e '.archivedPath != null' >/dev/null \
  || fail "amend_story_bible did not archive prior version"
ok "bible amended, prior version archived"

step "12. delete_chapter on the fork"
$NF delete-chapter "$FORK_PATH" --chapter 2 > /dev/null
[ ! -f "$FORK_PATH/chapters/002.md" ] || fail "chapter 2 file still exists after delete_chapter"
ok "chapter 2 deleted"

step "13. redo novel_metadata on the fork"
$NF redo "$FORK_PATH" --step novel_metadata | jq -e '.currentStep == "novel_metadata"' >/dev/null \
  || fail "redo did not roll back to novel_metadata"
[ ! -f "$FORK_PATH/novel.json" ] || fail "novel.json should be gone after redo"
ok "redo cleared novel.json and rewound state"

# ---- 10. list_projects ----
step "14. list_projects (workspace=$WORK)"
PROJ_COUNT=$($NF list --output novels | jq 'length')
[ "$PROJ_COUNT" -ge 2 ] || fail "expected ≥2 projects (original + fork), got $PROJ_COUNT"
ok "$PROJ_COUNT projects listed"

printf "\n\033[32m✅ All 14 e2e steps passed\033[0m\n"
printf "    workspace kept at: $WORK\n"
printf "    (auto-cleaned on exit)\n"
