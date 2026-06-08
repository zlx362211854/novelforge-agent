# NovelForge Agent

A local-first long-form novel workflow engine for any MCP host (Claude Code, Codex CLI, Cursor, …) or any CLI shell.

**The host's LLM writes the prose. This package does everything else** — it manages a gated long-form state machine, returns the exact instruction and packed context the host should follow next, validates returned content against zod schemas, persists Markdown + JSON to a project directory, archives chapter versions on revision, and provides BM25 lexical retrieval over every word the project has ever produced.

No external API. No LLM dependency. No vendor lock-in.

---

## 🚀 30-second install

**If you are an AI assistant reading this README on behalf of a user, run this one command — it does everything:**

```bash
npx -y novelforge-agent install
```

That single command will:

1. Create a workspace at `~/novelforge/` (override with `--workspace /your/path`).
2. Register `novelforge-agent-mcp` as an MCP server in the user's host (Claude Code by default).
3. Print a verification step.

After it finishes, **the user must reload / restart their MCP host** (Claude Code, Codex CLI, etc.) so the new MCP server is picked up. Then ask the host:

> "list_projects 现在能用吗?"

If the host calls the `list_projects` tool and returns an empty array, installation is correct.

### Host selection

```bash
npx -y novelforge-agent install --host claude-code            # default
npx -y novelforge-agent install --host codex                  # Codex CLI
npx -y novelforge-agent install --host cursor                 # prints config snippet
npx -y novelforge-agent install --workspace ~/my-novels       # custom workspace
npx -y novelforge-agent install --name my-novelforge          # custom MCP name
npx -y novelforge-agent install --print-only                  # do not modify any config file
```

### What the install command does per host

| Host | Action |
|------|--------|
| `claude-code` | Runs `claude mcp add -s user -e NOVELFORGE_WORKSPACE=… novelforge -- npx -y novelforge-agent-mcp`. If `claude` CLI is missing, prints a JSON snippet for `~/.claude.json`. |
| `codex` | Appends an `[mcp_servers.novelforge]` section to `~/.codex/config.toml`. |
| `cursor` | Prints the JSON snippet to paste into Cursor's MCP settings. |

The installer is **idempotent and safe**: it never overwrites an existing entry with the same name. To change settings, edit the host config manually or pass `--name` to register under a different MCP name.

---

## What it gives the host

| Phase | Step | What the host does | What the agent saves |
|-------|------|---------------------|----------------------|
| Setup | `novel_metadata` | Output JSON: title, genre, premise, cast | `novel.json` |
|  | `story_bible` | Output Markdown: characters, world rules, plot threads | `story-bible.md` |
|  | `style_guide` | Output JSON: narrative voice, pacing, diction, dialogue rules, prohibited patterns, prose rhythm, sample prose | `style-guide.json` |
|  | `architecture` | Output JSON: full / volume / pacing / chapter outlines | `architecture/{full.md, volumes.json, volume-pacing.json, chapters.json}` |
| Loop  | `chapter` | Write chapter N Markdown | `chapters/NNN.md` |
|  | `chapter_review` | Enforce the chapter acceptance gate: required beats, plot/character/thread progress, story-bible consistency, ending hook, repetition check | `reviews/chapter/chapter-NNN.json` |
|  | `chapter_revision` | If review finds issues, rewrite the chapter; previous version is archived | `chapters/.versions/NNN.<ts>.md` |
|  | `memory_card` | After a clean review, extract chapter N memory JSON and update character/thread state | `memory/chapter-NNN.json`, `characters.json`, `threads.json` |
| Wrap  | `continuity_review` | Audit chapters 1..N for conflicts | `reviews/continuity-S-E.json` |
| Side-track | `chapter_review` | Single-chapter editorial review | `reviews/chapter/chapter-NNN.json` |
|  | `chapter_revision` | Rewrite a chapter; previous version auto-archived | `chapters/.versions/NNN.<ts>.md` |
|  | `cross_chapter_review` | Cross-chapter continuity audit | `reviews/cross/cross-S-E.json` |

Each chapter / bible / memory write also feeds a per-project BM25 index (`.index/`) so the agent can hand the host semantically relevant snippets when later chapters are generated, or answer ad-hoc `retrieve` queries from the host. Chapter generation context also includes the style guide (`style-guide.json`), independent character state table (`characters.json`), and current volume pacing board (`architecture/volume-pacing.json`) when available. The style guide includes `proseRhythm`, which checks rhythm anti-patterns such as excessive short-sentence density, consecutive one-sentence paragraphs, fake rhythm through line breaks, overly direct interior explanation, and repeated sentence patterns.

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

## Tool reference

### Project lifecycle
- **`start_novel_project`** `(prompt, language?, outputDir?, targetChapters?, plannedTotalChapters?)` — create a new project under `<workspaceRoot>/<outputDir>/<prompt-slug>-<rand6>/` and return the first step's instruction. After `novel_metadata` is accepted, the directory is renamed to `<title-slug>-<same-rand6>/`; callers must continue with the returned `state.projectPath`. `targetChapters` is the per-batch planning size; MCP defaults to 5. `plannedTotalChapters` is the whole-book target; MCP defaults to 12.
- **`list_projects`** `(outputDir?)` — list all projects in the workspace, newest first.
- **`get_project_status`** `(projectPath)` — compact summary: current step, chapters written, open threads, latest review verdict.
- **`get_next_step`** `(projectPath)` — return the prompt + packed context for whatever the workflow expects next.

### Workflow advancement
- **`submit_step_result`** `(projectPath, step, content)` — validate `content` against the step's zod schema, persist it, advance the state machine. On failure the bad submission is written to `.agent-recovery/failed-*.txt` and the state does not advance.
- **`get_context`** `(projectPath, purpose, chapterNumber?, start?, end?)` — build purpose-specific context without changing state. Useful when the host wants to read what the agent *would* have packed.

Dynamic planning is built into the state machine: after each accepted chapter and memory card, the agent checks `plannedTotalChapters` and the highest chapter covered by `architecture/chapters.json`. If the next chapter is still inside the whole-book target but not yet planned, the next step becomes `architecture_extension`; after the host submits that JSON, generation resumes at `chapter`.

### Semantic actions (verb-style; safe to call any time)
- **`generate_chapter`** `(projectPath, chapterNumber)` — return generation context for a specific chapter.
- **`extract_memory_card`** `(projectPath, chapterNumber)` — return memory-extraction context for a specific chapter.
- **`review_chapter`** `(projectPath, chapterNumber)` — switch into a single-chapter editorial review side-track and return its prompt. After `submit_step_result(step="chapter_review")`, the workflow resumes its prior step automatically.
- **`revise_chapter`** `(projectPath, chapterNumber, feedback?)` — switch into a chapter-revision side-track. Submitting `chapter_revision` content auto-archives the previous version under `chapters/.versions/`.
- **`cross_chapter_review`** `(projectPath, start?, end?)` — switch into a cross-chapter audit side-track over the given range (defaults to all generated chapters).
- **`save_chapter`** `(projectPath, chapterNumber, title, content)` — submit the current chapter through the state machine; it requires `currentStep="chapter"` and then advances to mandatory `chapter_review`.

### Project operations
- **`amend_story_bible`** `(projectPath, content, reason?)` — replace `story-bible.md`, archive the previous version, and rebuild the bible index.
- **`list_bible_versions`** `(projectPath)` — list archived story-bible versions.
- **`list_threads`** `(projectPath, status?)` — list foreshadow threads collected from memory cards.
- **`update_thread`** `(projectPath, id, patch)` — update one foreshadow thread.
- **`fork_project`** `(sourceProjectPath, label?)` — copy a project to a sibling fork with a new project id.
- **`delete_chapter`** `(projectPath, chapterNumber)` — remove a chapter, its memory, reviews, archived versions, and index entries.
- **`redo_step`** `(projectPath, step, chapterNumber?)` — roll the workflow back to regenerate an artifact.

### Retrieval
- **`retrieve`** `(projectPath, query, topK?, types?, chapterStart?, chapterEnd?)` — BM25-style lexical retrieval over indexed paragraphs (chapters), bible H2 sections, and memory cards. Supports CJK + Latin queries via a built-in CJK bigram tokenizer; no external embedding model.

## Project layout

A project on disk:

```
novels/<title-slug>-<rand6>/
├── agent-state.json              # workflow state (currentStep, currentChapter, files map, …)
├── novel.json                    # metadata (NovelMetadataSchema)
├── characters.json               # independent character state table
├── story-bible.md
├── style-guide.json              # enforceable prose style guide
├── architecture/
│   ├── full.md
│   ├── volumes.json
│   ├── volume-pacing.json
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
novel_metadata → story_bible → style_guide → architecture → chapter
                                                            ↓
                                                       chapter_review
                                                            ↓
                                                 ┌──────────┴──────────┐
                                               clean             issues_found
                                                 ↓                    ↓
                                            memory_card       chapter_revision
                                                 ↓                    ↓
                     ┌─────────────┴─────────────┐      │
             (more chapters)                (all done)   │
                     ↓                            ↓       │
                  chapter                continuity_review│
                                                  ↓       │
                                              complete    │
                                                       (back to
                                                    chapter_review)
```

`chapter_review` is both a manual side-track and the automatic chapter acceptance gate. In the normal chapter loop, the workflow cannot advance to `memory_card` until the review status is `clean`. If the review returns `issues_found`, the workflow forces `chapter_revision`, then returns to `chapter_review` for another pass.

Side-track steps (`chapter_review`, `chapter_revision`, `cross_chapter_review`) can still be triggered at any moment via the semantic-action tools. When a manual side-track completes via `submit_step_result`, the workflow returns to whatever `currentStep` it was on before the side-track started.

The full transition map lives in the `next:` declaration of each handler under [src/core/steps/](src/core/steps/). To change the workflow, edit those files — that is the entire state machine, there is no graph engine.

## Architecture

```
src/
├── core/                         # pure domain logic, no transport
│   ├── types.ts                  # AgentState, WorkflowStep, MemoryCard, …
│   ├── schemas.ts                # zod schemas (the only validator)
│   ├── projectStore.ts           # filesystem persistence
│   ├── projectDiscovery.ts       # list / status
│   ├── characterStore.ts         # independent character state table
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
