# NovelForge Agent

> **Write a coherent 100-chapter novel with the LLM you already have.**
> No API keys. No subscriptions. Your files. Your model.

[中文文档](README.zh-CN.md) · [npm](https://www.npmjs.com/package/novelforge-agent) · [GitHub](https://github.com/zlx362211854/novelforge-agent)

NovelForge turns Claude Code (or any MCP host) into a disciplined long-form fiction co-author. **You bring the LLM. NovelForge enforces the structure that makes 100 chapters actually hang together** — and refuses to let your AI silently forget the rules.

---

## Why NovelForge?

The hard part of AI-assisted long-form fiction is not generating chapter 1. It's making chapter 73 still believe what chapter 12 established. Models drift. Tics accumulate. Foreshadows get dropped. Characters change cultivation stage mid-saga.

| The thing that always breaks | NovelForge's answer |
|---|---|
| By chapter 30, the protagonist's powers are inconsistent | **Independent character state table** — every chapter must consult & respect it |
| "By chapter 12 the AI forgot the bible" | Bible is **injected into every chapter prompt** + **BM25 retrieval** surfaces relevant past snippets |
| The AI loves "不是X而是Y" / "in that moment" / em-dash spam | **15-entry AI-tic catalog with hard caps**; review gate refuses chapters that exceed them |
| Foreshadows planted and never paid off | **Foreshadow lifecycle tracker** (planted → building → paid / dropped); active threads injected into every chapter |
| "I told the AI to revise but it just wrote the same thing again" | **Mandatory chapter acceptance gate** — must return `clean` before workflow advances. Issues → forced revision, max 3 rounds |
| Style drifts after the first 5 chapters | Generated **style guide** (voice, pacing, diction, prose rhythm) enforced every chapter |
| Volume structure becomes mush after 30 chapters | **Volume pacing board** (promise / midpoint / climax / payoffs / lingering mysteries); chapters get told their beat position |
| Lost track of which subplot is where | Built-in **BM25 retrieval** — `retrieve("昆吾剑")` shows every chapter and memory card touching that thread |
| Long context costs a fortune | **Prompt-cacheable segments** + per-step **`modelHint`** (Haiku for memory extraction, Opus for prose). ~30-50% token savings |
| 100-chapter outline impossible to keep coherent | **Dynamic architecture extension** — plan 5 chapters at a time, agent auto-prompts the next planning batch when needed |

---

## What you get

### 🎯 Quality-gated workflow
Every chapter must pass an **8-dimension acceptance gate** (required beats, narrative progress, character progress, foreshadow progress, story-bible consistency, prose rhythm, ending hook, repetition) before the next chapter can begin. Fail → forced revision. Cap at 3 rounds, then manual override.

### 📚 Living domain knowledge that travels with the project
- **Story bible** (Markdown) — amend mid-novel, old versions auto-archived
- **Style guide** (JSON, including prose-rhythm anti-patterns)
- **Volume pacing board** per volume — setup / promise / midpoint / climax / payoffs
- **Character state table** — cultivation stage, goals, beliefs, secrets, relationships — auto-updated from each chapter's memory card

### 🧵 Foreshadow lifecycle tracker
Every chapter declares which threads it plants / builds / pays / drops. The agent maintains an active-threads list and injects it into the next chapter prompt — so the AI **literally cannot silently drop a plotline**.

### 🔍 Local BM25 retrieval (no embeddings, no API)
Search any term across all chapters, story-bible sections, and memory cards. **CJK-aware tokenizer** (bigram + Latin). Used both automatically (every chapter prompt gets relevant past snippets) and on-demand via the `retrieve` tool.

### 🚫 AI-tic defense
15 catalogued LLM tics — **"不是X而是Y"**, "in that moment", staccato single-sentence chains, parenthetical interior monologue, em-dash overuse, sensory tricolons, end-of-paragraph epiphanies, simile pile-ups, restate-summary closes, subject repetition, rhetorical-question lyric, dialogue fragmenting, and more — explicitly banned in the chapter prompt, counted in the review, and enforced via the revision gate.

### 💾 Your project is a folder
Everything is plain text + JSON in one directory. **Copy it. Email it. Resume tomorrow.** No vendor cloud.

### 🛟 Escape hatches when things go wrong
- `fork_project` — try a different chapter 5 without losing the original
- `delete_chapter` — clean removal, including index entries
- `redo_step` — back up to regenerate an artifact
- `force_advance` — manually exit a stuck review loop
- All chapter revisions auto-archive the prior version under `chapters/.versions/`

### 💰 Cost-aware by design
- `modelHint: 'cheap' | 'standard' | 'premium'` per step — hosts route memory extraction to Haiku, prose to Opus
- **Cacheable prompt segments** — the ~5K-token chapter rules block is byte-identical across chapters; Anthropic prompt cache pays for it once per 5 minutes, not every chapter

---

## How NovelForge compares

| | **NovelForge** | Sudowrite / NovelCrafter | LangChain-based scripts | Plain Claude / ChatGPT |
|---|---|---|---|---|
| Files on your disk | ✅ | ❌ SaaS | depends | ❌ |
| Bring your own LLM | ✅ | ❌ they pick | ❌ needs your key | ✅ |
| No subscription | ✅ | ❌ $20+/mo | ✅ you pay tokens only | ✅ but no structure |
| 100-chapter coherence | ✅ structured | ⚠️ best-effort | ❌ | ❌ |
| AI-tic enforcement | ✅ 15 caps + audit | ⚠️ | ❌ | ❌ |
| Works inside your MCP host | ✅ native | ❌ | ❌ | ❌ |
| Switch models freely (Sonnet/Opus/Haiku/Gemini/GPT) | ✅ | ❌ | ⚠️ rewrite needed | ✅ |
| Open source | ✅ MIT | ❌ | ✅ | — |

---

## 30-second install

If you have **Claude Code** installed, tell it:

> "Install novelforge-agent."

Claude will run the install command, register the MCP server, and tell you to restart. Or do it yourself:

```bash
npx -y novelforge-agent install
```

Then **quit Claude Code (Cmd+Q) and reopen it**. Try:

> "Start a new novel project: a cyberpunk cultivation story, 30 chapters."

Claude will discover the tools and walk through the workflow autonomously.

### Other hosts

```bash
npx -y novelforge-agent install --host claude-code   # default
npx -y novelforge-agent install --host codex         # writes ~/.codex/config.toml
npx -y novelforge-agent install --host cursor        # prints JSON snippet
npx -y novelforge-agent install --workspace ~/novels # custom workspace
npx -y novelforge-agent install --print-only         # don't touch any config file
```

Any MCP host that supports stdio servers works — paste the printed JSON snippet into Cline, Continue, LibreChat, Goose, Zed, or VS Code MCP extensions.

---

## What writing one chapter looks like

```
You:  "继续写下一章"
  │
  ▼
Claude → get_project_status      (knows where you are)
Claude → get_next_step           (gets the chapter-N prompt)
        │
        │  The prompt comes with:
        │   • Story bible (truncated to 4K chars)
        │   • Active character states
        │   • Volume pacing position ("rising_action, midpoint at ch 12")
        │   • Active foreshadow threads
        │   • Retrieved snippets from prior chapters (BM25)
        │   • Style guide (incl. prose-rhythm anti-patterns)
        │   • 15 AI tics explicitly banned
        │   • Target word count (~3000 ±20%)
        ▼
Claude generates the chapter → save_chapter
  │
  ▼
chapter_review (automatic gate, 8 dimensions audited)
  │
  ├── clean? ────────────► memory_card → threads & characters auto-updated → next chapter
  │
  └── issues_found? ────► chapter_revision (prior version auto-archived)
                              │
                              └─► back to chapter_review
                                  (max 3 rounds, then force_advance with audit trail)
```

**Every chapter touches multiple LLM calls**, but you only said one sentence. The discipline is invisible to you and inflexible to the model.

---

## Real talk: who this is for

**You'll love it if you're**:
- An indie / serial author who wants AI help **without giving up file ownership**
- Already using Claude Code / Codex / Cursor and don't want yet another tool
- Tired of "every Sudowrite-clone looks the same" — you want to pick your own model
- Writing 万字+ work where chapter 50 must remember chapter 5

**Look elsewhere if**:
- You want a fancy web UI with timelines and corkboards (use Plottr / Scrivener + Sudowrite)
- You want to write 3-page short stories (Claude alone is fine)
- You don't have any MCP host installed and don't want one (this isn't a standalone web app)

---

## Tool reference (26 tools)

<details>
<summary><strong>Lifecycle & status (4)</strong></summary>

- `start_novel_project` — create a project, returns the first step's prompt
- `list_projects` — list all projects, newest first
- `get_project_status` — one-screen briefing for a project
- `get_next_step` — return the next prompt + packed context
</details>

<details>
<summary><strong>Workflow (3)</strong></summary>

- `submit_step_result` — submit content for the current step (validated against zod schema)
- `get_context` — build purpose-specific context without changing state
- `save_chapter` — submit a chapter through the workflow gate (forces `chapter_review` next)
</details>

<details>
<summary><strong>Semantic actions (5)</strong></summary>

- `generate_chapter` — return generation context for a specific chapter
- `extract_memory_card` — return memory-extraction context for a chapter
- `review_chapter` — single-chapter editorial review side-track
- `revise_chapter` — rewrite a chapter (auto-archives prior version)
- `cross_chapter_review` — multi-chapter continuity audit
</details>

<details>
<summary><strong>Domain knowledge editing (5)</strong></summary>

- `amend_novel_metadata` — update title / genre / cast (auto-renames directory if title changes)
- `amend_story_bible` — replace bible, archive previous version, re-index
- `list_bible_versions` — list archived bible versions
- `list_threads` / `update_thread` — read & curate the foreshadow tracker
</details>

<details>
<summary><strong>Retrieval (1)</strong></summary>

- `retrieve` — BM25 over chapters / bible / memory cards, CJK-aware
</details>

<details>
<summary><strong>Escape hatches (5)</strong></summary>

- `fork_project` — copy a project as a new branch
- `delete_chapter` — remove chapter + memory + reviews + index entries
- `redo_step` — roll back to regenerate an artifact
- `force_advance` — manually exit a stuck chapter_review/revision loop
</details>

<details>
<summary><strong>Observability (4)</strong></summary>

- `get_recent_events` — recent audit events from `.agent-logs/events.jsonl`
- `list_runs` — recent MCP tool invocations grouped by `runId`
- `get_run_log` — full event log for one run
- `get_artifact_summary` — file size / mtime / sha256 without exposing content
</details>

All tools return Markdown summaries by default; pass `verbose: true` to also receive the raw JSON payload. Workflow tools' `instruction` / `context` previews are bounded — full payloads land in `.agent-recovery/mcp-context/`.

---

## How the workflow advances

```
novel_metadata → story_bible → style_guide → architecture → chapter
                                                            ↓
                                                       chapter_review
                                                       ┌────┴────┐
                                                    clean    issues_found
                                                       ↓          ↓
                                                memory_card  chapter_revision
                                                       ↓          ↓
                                ┌─────────────────────┐    back to chapter_review
                          next chapter         all chapters done
                            planned                    ↓
                              ↓               continuity_review
                           chapter                     ↓
                            (loop)                  complete
                              ↑
                              │
                    architecture_extension
                    (auto-triggered when planned < total)
```

`chapter_review` is both the **automatic gate** in the linear loop and a **side-track** you can trigger manually any time. Side-tracks for `chapter_review`, `chapter_revision`, and `cross_chapter_review` resume to their prior step when complete.

The transition map lives in each handler under [src/core/steps/](src/core/steps/) plus the dispatcher in [src/core/workflow.ts](src/core/workflow.ts). No external graph engine.

---

## Project layout on disk

```
novels/<title-slug>-<rand6>/
├── agent-state.json              # current step, files map, revision counters
├── novel.json                    # title / genre / premise / cast
├── characters.json               # independent character state table
├── story-bible.md
├── style-guide.json              # voice / pacing / diction / proseRhythm
├── architecture/
│   ├── full.md
│   ├── volumes.json
│   ├── volume-pacing.json
│   └── chapters.json
├── chapters/
│   ├── 001.md
│   └── .versions/                # archived pre-revision snapshots
├── memory/
│   └── chapter-001.json
├── threads.json                  # foreshadow tracker
├── reviews/
│   ├── chapter/chapter-NNN.json
│   ├── cross/cross-S-E.json
│   └── continuity-1-N.json
├── .index/                       # BM25 (MiniSearch)
├── .agent-logs/events.jsonl      # audit trail
└── .agent-recovery/              # rejected submissions + large-context spillover
```

**The whole directory is self-contained** — `cp -r` it to a USB stick, share it on Dropbox, commit it to git. No external state.

---

## Use from a shell (no MCP host needed)

The same engine drives a plain CLI:

```bash
# Start a new project
novelforge-agent start --prompt "写一本赛博修仙小说" --length medium --chapters 5

# Inspect / continue
novelforge-agent list
novelforge-agent status novels/<slug>
novelforge-agent next novels/<slug>

# Submit a chapter you wrote yourself (or via any LLM)
novelforge-agent submit novels/<slug> --step chapter --file ch1.md

# Review / revise / retrieve / cross-review — same as MCP tools
novelforge-agent review novels/<slug> --chapter 3
novelforge-agent revise novels/<slug> --chapter 3 --feedback "让节奏更紧"
novelforge-agent retrieve novels/<slug> --query "昆吾剑" --top-k 8
novelforge-agent cross-review novels/<slug> --start 1 --end 5
```

Output is Markdown by default. Use `--json` for machine-parseable output.

---

## Cost optimization for hosts

Every step instruction includes two fields hosts can use to cut LLM cost dramatically.

### `modelHint`

```ts
type ModelHint = 'cheap' | 'standard' | 'premium';
```

| Step | Hint | Why |
|---|---|---|
| `chapter`, `chapter_revision`, `story_bible`, `architecture`, `architecture_extension` | `premium` | Creative prose |
| `style_guide`, `chapter_review`, `*_amend`, `cross_chapter_review`, `continuity_review` | `standard` | Analytical / structured |
| `memory_card`, `complete` | `cheap` | Extractive / trivial |

### `segments[]` — prompt caching

Each step instruction is split into `cacheable: true` / `false` parts. The `rules` segment of chapter generation (~5K tokens) is **byte-identical across every chapter**. Anthropic-style `cache_control: { type: 'ephemeral' }` saves ~30% input cost on a 30-chapter novel.

[Anthropic API caching example →](#full-anthropic-api-example)

---

## Design philosophy

**The host's LLM is the only thing in this system that thinks.** NovelForge is a runtime that knows:

- the **order** of work (state machine)
- the **shape** of every artifact (zod schemas)
- the **vocabulary** of the domain (prompts + rules)

…and refuses to let the host save anything that violates those rules.

We deliberately chose this architecture over the more common "MCP server with its own LLM" pattern:

- **Your data, your model**: zero API keys inside NovelForge. No vendor lock-in.
- **Cost transparency**: token costs go through your host's billing, not a hidden middleman.
- **Model agility**: switch from Sonnet to Opus to Haiku to Gemini to your local Llama — same agent, no migration.
- **Host-agnostic**: Claude Code today, Cursor tomorrow, future MCP hosts the day after. The agent doesn't care.

The trade-off: NovelForge **doesn't work without an MCP host or someone willing to write prose at the CLI**. It's not a standalone "AI novel generator" web app. It's the **discipline layer underneath whatever LLM you already use**.

---

## Architecture

```
src/
├── core/                          # pure domain logic, no transport
│   ├── types.ts                   # AgentState, WorkflowStep, MemoryCard, …
│   ├── schemas.ts                 # zod schemas (the only validator)
│   ├── projectStore.ts            # filesystem persistence
│   ├── characterStore.ts          # character state table
│   ├── threadStore.ts             # foreshadow lifecycle
│   ├── prompts/                   # per-language prompt packs (zh-CN, en-US)
│   ├── steps/                     # one file per WorkflowStep handler
│   ├── retrieval/                 # BM25 index + CJK tokenizer
│   ├── contextBuilder.ts          # purpose-specific context packing
│   └── workflow.ts                # dispatcher: state machine + side-tracks
├── mcp/
│   ├── server.ts                  # stdio MCP entrypoint
│   └── tools.ts                   # 26 MCP tools + 10 MCP prompts
└── cli/
    └── index.ts                   # equivalent CLI subcommands
```

The agent has **zero LLM dependency**:

```bash
$ grep -RIl "anthropic\|openai\|@google" src package.json
# (no results — only @modelcontextprotocol/sdk, zod, minisearch)
```

---

## Install from source / contribute

```bash
git clone https://github.com/zlx362211854/novelforge-agent.git
cd novelforge-agent
npm install
npm run build
npm test       # 89 unit + integration tests
npm run test:e2e   # 15-step CLI end-to-end smoke (no LLM needed)
```

Adding a new workflow step:

1. Add the step name to `WorkflowStep` in [src/core/types.ts](src/core/types.ts)
2. Add a zod schema in [src/core/schemas.ts](src/core/schemas.ts)
3. Add prompt builders in [src/core/prompts/zh-CN.ts](src/core/prompts/zh-CN.ts) and [en-US.ts](src/core/prompts/en-US.ts)
4. Create a handler under `src/core/steps/<name>.ts`
5. Register it in [src/core/steps/index.ts](src/core/steps/index.ts)
6. If it needs packed context, add an entry to `CONTEXT_RECIPES` in [src/core/workflow.ts](src/core/workflow.ts)
7. Add it to the `step` enum of `submit_step_result` in [src/mcp/tools.ts](src/mcp/tools.ts)

---

## Full Anthropic API example

```ts
import Anthropic from '@anthropic-ai/sdk';

// Pull the next step's segments + modelHint from NovelForge
const next = await getNextStepViaMcp(projectPath);
const rules = next.segments.find((s) => s.id === 'rules');
const meta  = next.segments.find((s) => s.id === 'chapter_meta');
const ctx   = next.segments.find((s) => s.id === 'context');

const anthropic = new Anthropic();
const model = ({ cheap: 'claude-haiku-4-5', standard: 'claude-sonnet-4-7', premium: 'claude-opus-4-7' })[next.modelHint];

const reply = await anthropic.messages.create({
  model,
  max_tokens: 8000,
  system: [{ type: 'text', text: rules.text, cache_control: { type: 'ephemeral' } }],
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: meta.text },
      { type: 'text', text: ctx.text },
    ],
  }],
});

await submitStepResult(projectPath, next.currentStep, reply.content[0].text);
```

---

## License

MIT. See [LICENSE](LICENSE).
