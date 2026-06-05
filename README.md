# NovelForge Agent

A local-first long-form novel workflow engine for any MCP host (Claude Code, Codex CLI, …) or any CLI shell.

**The host's LLM writes the prose. This package does everything else** — it manages a 9-step state machine, returns the exact instruction and packed context the host should follow next, validates returned content against zod schemas, persists Markdown + JSON to a project directory, archives chapter versions on revision, and provides BM25 lexical retrieval over every word the project has ever produced.

No external API. No LLM dependency. No vendor lock-in.

## What it gives the host

| Phase | Step | What the host does | What the agent saves |
|-------|------|---------------------|----------------------|
| Setup | `novel_metadata` | Output JSON: title, genre, premise, cast | `novel.json` |
|  | `story_bible` | Output Markdown: characters, world rules, plot threads | `story-bible.md` |
|  | `architecture` | Output JSON: full / volume / chapter outlines | `architecture/{full.md, volumes.json, chapters.json}` |
| Loop  | `chapter` | Write chapter N Markdown | `chapters/NNN.md` |
|  | `memory_card` | Extract chapter N memory JSON | `memory/chapter-NNN.json` |
| Wrap  | `continuity_review` | Audit chapters 1..N for conflicts | `reviews/continuity-S-E.json` |
| Side-track | `chapter_review` | Single-chapter editorial review | `reviews/chapter/chapter-NNN.json` |
|  | `chapter_revision` | Rewrite a chapter; previous version auto-archived | `chapters/.versions/NNN.<ts>.md` |
|  | `cross_chapter_review` | Cross-chapter continuity audit | `reviews/cross/cross-S-E.json` |

Each chapter / bible / memory write also feeds a per-project BM25 index (`.index/`) so the agent can hand the host semantically relevant snippets when later chapters are generated, or answer ad-hoc `retrieve` queries from the host.

## Install

Requires Node 20+.

```bash
git clone <this repo>
cd novelforge-agent
npm install
npm run build
```

Run the test suite to confirm:

```bash
npm test
```

## Use it from a CLI shell

```bash
# 1. Start a new project
node dist/src/cli/index.js start --prompt "写一本赛博修仙小说" --chapters 5
# → prints { state, next } — next.instruction is the prompt for step 1

# 2. List existing projects
node dist/src/cli/index.js list
# → newest first, with current step and chapter count

# 3. Show one project's status
node dist/src/cli/index.js status novels/<slug>

# 4. Get the next step's instruction + context
node dist/src/cli/index.js next novels/<slug>

# 5. Submit your generated content (file containing JSON or Markdown)
node dist/src/cli/index.js submit novels/<slug> --step chapter --file ch1.md

# 6. Trigger a single-chapter review
node dist/src/cli/index.js review novels/<slug> --chapter 3

# 7. Trigger a revision (feedback can be a literal string or --feedback-file)
node dist/src/cli/index.js revise novels/<slug> --chapter 3 --feedback "让节奏更紧"

# 8. Cross-chapter audit (defaults to all generated chapters)
node dist/src/cli/index.js cross-review novels/<slug> --start 1 --end 5

# 9. Lexical retrieval over chapters + bible + memory cards
node dist/src/cli/index.js retrieve novels/<slug> \
  --query "昆吾剑" --top-k 8 --types chapter,memory --start 1 --end 5

# 10. Build purpose-specific context (useful for debugging prompts)
node dist/src/cli/index.js context novels/<slug> \
  --purpose chapter_generation --chapter 4
```

English projects: pass `--language en-US` to `start`. Every prompt has a parallel English form in [src/core/prompts/en-US.ts](src/core/prompts/en-US.ts).

## Use it as an MCP server

### Claude Code

```jsonc
// ~/.claude.json  (or your project's .mcp.json)
{
  "mcpServers": {
    "novelforge": {
      "command": "node",
      "args": ["/absolute/path/to/novelforge-agent/dist/src/mcp/server.js"],
      "env": {
        "NOVELFORGE_WORKSPACE": "/absolute/path/where/projects/should/live"
      }
    }
  }
}
```

Reload Claude Code and type:

> 我想写一本赛博修仙小说

Claude will discover the `start_novel_project` tool, call it, get back the first prompt for `novel_metadata`, generate the JSON, call `submit_step_result`, get back the next prompt, and continue autonomously until `complete`.

### Codex CLI

```toml
# ~/.codex/config.toml
[mcp_servers.novelforge]
command = "node"
args = ["/absolute/path/to/novelforge-agent/dist/src/mcp/server.js"]

[mcp_servers.novelforge.env]
NOVELFORGE_WORKSPACE = "/absolute/path/where/projects/should/live"
```

### Resuming work in a later session

`list_projects` finds every project under `NOVELFORGE_WORKSPACE/novels/`, sorted newest first. The host should call it before anything else when a session opens; pick the desired `projectPath` from the result, then `get_project_status` for a one-screen briefing, then `get_next_step` to resume.

## Tool reference (13 MCP tools)

### Project lifecycle
- **`start_novel_project`** `(prompt, language?, outputDir?, targetChapters?)` — create a new project under `<workspaceRoot>/<outputDir>/<slug>-<rand6>/` and return the first step's instruction.
- **`list_projects`** `(outputDir?)` — list all projects in the workspace, newest first.
- **`get_project_status`** `(projectPath)` — compact summary: current step, chapters written, open threads, latest review verdict.
- **`get_next_step`** `(projectPath)` — return the prompt + packed context for whatever the workflow expects next.

### Workflow advancement
- **`submit_step_result`** `(projectPath, step, content)` — validate `content` against the step's zod schema, persist it, advance the state machine. On failure the bad submission is written to `.agent-recovery/failed-*.txt` and the state does not advance.
- **`get_context`** `(projectPath, purpose, chapterNumber?, start?, end?)` — build purpose-specific context without changing state. Useful when the host wants to read what the agent *would* have packed.

### Semantic actions (verb-style; safe to call any time)
- **`generate_chapter`** `(projectPath, chapterNumber)` — return generation context for a specific chapter.
- **`extract_memory_card`** `(projectPath, chapterNumber)` — return memory-extraction context for a specific chapter.
- **`review_chapter`** `(projectPath, chapterNumber)` — switch into a single-chapter editorial review side-track and return its prompt. After `submit_step_result(step="chapter_review")`, the workflow resumes its prior step automatically.
- **`revise_chapter`** `(projectPath, chapterNumber, feedback?)` — switch into a chapter-revision side-track. Submitting `chapter_revision` content auto-archives the previous version under `chapters/.versions/`.
- **`cross_chapter_review`** `(projectPath, start?, end?)` — switch into a cross-chapter audit side-track over the given range (defaults to all generated chapters).
- **`save_chapter`** `(projectPath, chapterNumber, title, content)` — write a chapter Markdown file directly, without going through the state machine.

### Retrieval
- **`retrieve`** `(projectPath, query, topK?, types?, chapterStart?, chapterEnd?)` — BM25-style lexical retrieval over indexed paragraphs (chapters), bible H2 sections, and memory cards. Supports CJK + Latin queries via a built-in CJK bigram tokenizer; no external embedding model.

## Project layout

A project on disk:

```
novels/<slug>-<rand6>/
├── agent-state.json              # workflow state (currentStep, currentChapter, files map, …)
├── novel.json                    # metadata (NovelMetadataSchema)
├── story-bible.md
├── architecture/
│   ├── full.md
│   ├── volumes.json
│   └── chapters.json
├── chapters/
│   ├── 001.md
│   ├── 002.md
│   └── .versions/                # archived pre-revision chapter snapshots
├── memory/
│   └── chapter-001.json
├── reviews/
│   ├── continuity-1-N.json
│   ├── chapter/chapter-NNN.json
│   └── cross/cross-S-E.json
├── .index/
│   ├── lexical.json              # MiniSearch serialization
│   └── manifest.json             # external doc id list
└── .agent-recovery/
    ├── failed-*.txt              # rejected submissions kept for inspection
    └── side-track.json           # resume hint when in a review/revision side-track
```

The whole directory is self-contained — copy it, share it, delete it.

## How the workflow advances

```
novel_metadata → story_bible → architecture → chapter
                                              ↓
                                          memory_card
                                              ↓
                              ┌───────────────┴───────────────┐
                  (more chapters)                       (all done)
                              ↓                               ↓
                          chapter                    continuity_review
                                                              ↓
                                                          complete
```

Side-track steps (`chapter_review`, `chapter_revision`, `cross_chapter_review`) can be triggered at any moment via the semantic-action tools. When the side-track completes via `submit_step_result`, the workflow returns to whatever `currentStep` it was on before the side-track started.

The full transition map lives in the `next:` declaration of each handler under [src/core/steps/](src/core/steps/). To change the workflow, edit those files — that is the entire state machine, there is no graph engine.

## Architecture

```
src/
├── core/                         # pure domain logic, no transport
│   ├── types.ts                  # AgentState, WorkflowStep, MemoryCard, …
│   ├── schemas.ts                # zod schemas (the only validator)
│   ├── projectStore.ts           # filesystem persistence
│   ├── projectDiscovery.ts       # list / status
│   ├── prompts/                  # per-language prompt packs (zh-CN, en-US)
│   ├── steps/                    # one file per WorkflowStep handler
│   ├── retrieval/                # BM25 index + CJK tokenizer + chunker
│   ├── contextBuilder.ts         # purpose-specific context packing
│   └── workflow.ts               # dispatcher: contextForStep + side-track + submit
├── mcp/
│   ├── server.ts                 # stdio entrypoint
│   └── tools.ts                  # 13 MCP tool registrations
└── cli/
    └── index.ts                  # equivalent CLI subcommands
```

The agent has no LLM dependency:

```bash
$ grep -RIl "anthropic\|openai\|@google" src package.json
# (no results)
```

Only `@modelcontextprotocol/sdk`, `zod`, `minisearch`.

## Adding a new workflow step

1. Add the step name to `WorkflowStep` in [src/core/types.ts](src/core/types.ts).
2. Add a zod schema in [src/core/schemas.ts](src/core/schemas.ts) (if the step accepts structured content).
3. Add a prompt builder in [src/core/prompts/zh-CN.ts](src/core/prompts/zh-CN.ts) and [src/core/prompts/en-US.ts](src/core/prompts/en-US.ts).
4. Create a handler under `src/core/steps/<name>.ts` returning a `StepApplyResult`.
5. Register it in [src/core/steps/index.ts](src/core/steps/index.ts).
6. (If the step needs packed context) add an entry to `CONTEXT_RECIPES` in [src/core/workflow.ts](src/core/workflow.ts).
7. Add the step name to the `step` enum in [src/mcp/tools.ts](src/mcp/tools.ts) `submit_step_result`.

## Design principle

The host's LLM is the only thing in this system that thinks. The agent is a pure I/O machine that knows the *order* of work, the *shape* of every artifact, and the *vocabulary* of the domain — and refuses to let the host save anything that violates those rules. Long-form fiction needs that discipline more than it needs another LLM wrapper.
