# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] – 2026-06-10

### Added
- **Revision-loop hard cap**: `AgentState.revisionCounts` tracks chapter-level
  revision rounds. After `MAX_REVISION_ROUNDS` (3) the workflow auto-advances
  the chapter to `memory_card` and records it in `AgentState.forceAdvanced`.
  Prevents infinite chapter_review → chapter_revision loops on stubborn issues.
- `force_advance` MCP tool + `force-advance` CLI subcommand for manual exit
  from a stuck review/revise gate.
- `ProjectStatus` now exposes `revisionCounts` and `forceAdvanced` so callers
  can surface stuck or un-fixed chapters.

### Changed
- Chapter generation prompts (zh-CN + en-US) now explicitly reference
  **Character State Table** and **Volume Pacing Board** with usage rules, so
  the data those sections inject is actually consulted by the host LLM
  instead of being ignored as background text.

### Fixed
- `fixtures/` is no longer in `.gitignore`. The directory is now tracked so
  `scripts/e2e.sh` runs correctly in CI.

## [0.8.0] – 2026-06

### Added
- `architecture_extension` workflow step + handler for incrementally planning
  additional chapter architectures past `targetChapters`, up to
  `plannedTotalChapters`. Lets long-form projects extend in batches.
- Run / audit logging: `list_runs`, `get_run_log`, `get_recent_events` MCP
  tools. Each tool invocation is recorded so the host can audit what
  happened in a session.
- `get_artifact_summary` MCP tool returning compact length/sha256 summaries
  for large project artifacts.

### Changed
- README architecture section reflects the v0.8 workflow.

## [0.7.0]

### Added
- `amend_novel_metadata` step + tool: metadata can now evolve like the
  story bible. Previous versions auto-archived.

## [0.6.0]

### Added
- `plannedTotalChapters` field on `AgentState`. Separates "batch target"
  (`targetChapters`) from "whole-book target" (`plannedTotalChapters`).

### Changed
- `start_novel_project` now accepts a length preset (`short` / `medium` /
  `long`) and computes a sensible `plannedTotalChapters` default.

## [0.5.0]

### Added
- `style_guide` workflow step between `story_bible` and `architecture`.
  Structured prose-rhythm rules (sentenceRhythm / paragraphing /
  interiorityMode / emphasisBudget / antiPatterns) become a first-class
  artifact that downstream prompts can enforce.
- `proseRhythm` dimension on `ChapterAcceptanceGate` (8 dimensions total).

## [0.4.0]

### Added
- **Character state table**: `characters.json` aggregator + `characterStore`
  module. Memory cards emit `characterUpdates[]`, the table is updated, and
  the current snapshot is injected into chapter-generation context.

### Changed
- `chapter_review` now sits inline between `chapter` and `memory_card` as a
  mandatory gate. If the review status is `issues_found`, the workflow
  routes to `chapter_revision`. On clean, advances to `memory_card`.
- `chapter_review` JSON gained a structured `acceptance` block with 7
  pass/fail dimensions (requiredBeats, narrativeProgress, characterProgress,
  foreshadowProgress, storyBibleConsistency, endingHook, repetition).

## [0.3.x]

### Added
- `volumePacing` board on `ArchitecturePayload`: per-volume start / promise /
  keyTurns / midpoint / climax / payoffs / lingeringMysteries. Injected into
  chapter-generation context.

## [0.2.0] – 2026-06

### Added
- `amend_story_bible` step + tool with auto-archive to
  `story-bible-versions/`. Bible can evolve mid-project.
- **Foreshadow lifecycle**: `threadStore`, `threads.json`, memory-card
  `threadActions[]`, active threads injected into chapter-generation context.
- Escape-hatch ops: `fork_project`, `delete_chapter`, `redo_step`.
- `list_threads`, `update_thread`, `list_bible_versions` MCP tools.
- **MCP Prompts**: 10 slash commands (`/nf-start`, `/nf-next`, `/nf-list`,
  `/nf-status`, `/nf-review-chapter`, `/nf-revise-chapter`,
  `/nf-cross-review`, `/nf-retrieve`, `/nf-amend-bible`, `/nf-threads`).
- Testing harness: `scripts/e2e.sh` (14-step CLI-driven full-workflow
  smoke), `scripts/claude-smoke.sh` (real-LLM headless smoke),
  `.github/workflows/ci.yml` (Node 20/22 matrix).
- Chapter architecture extended with `targetWords`, `requireRecap`,
  `endHookFocus`, `povCharacter`.
- `wordCount` field on memory cards.

### Changed
- Workflow expanded from 6 to 9 steps (adds `chapter_review`,
  `chapter_revision`, `cross_chapter_review`).
- Project slugs now include a 6-character random suffix to prevent
  collisions between projects sharing a prompt prefix.

## [0.1.1] – 2026-06

### Added
- `install` CLI subcommand: `npx -y novelforge-agent install` registers
  the MCP server with the user's host (Claude Code via `claude mcp add`,
  Codex CLI via TOML edit, or prints a Cursor snippet).
- README opens with a 30-second install section addressed to AI assistants.

## [0.1.0] – 2026-06

### Added
- Initial release.
- 6-step workflow: `novel_metadata` → `story_bible` → `architecture` →
  `chapter` ↔ `memory_card` → `continuity_review` → `complete`.
- 5 MCP tools (`start_novel_project`, `get_next_step`, `submit_step_result`,
  `get_context`, `save_chapter`) + CLI parity.
- BM25-style lexical retrieval over chapter paragraphs, story-bible H2
  sections, and memory cards. CJK bigram tokenizer (no embedding model).
  Auto-injected into chapter-generation context and exposed as the
  `retrieve` tool.
- Project state externalized to filesystem; every project is a
  self-contained directory.
- Bilingual (zh-CN, en-US) prompt packs.
- 47 unit + integration tests.

### Design principle
- The host's LLM is the only thing in this system that thinks. The agent
  is a pure I/O machine that knows the *order* of work, the *shape* of
  every artifact, and the *vocabulary* of the domain. No LLM dependency
  inside the agent.
