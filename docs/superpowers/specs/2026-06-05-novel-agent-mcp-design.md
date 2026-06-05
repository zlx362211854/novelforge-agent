# Pure Novel Agent Kit Design

## 1. Goal

Build a clean, local-first novel generation agent kit that can be used from Claude Code, Codex CLI, or any MCP-compatible coding assistant.

The kit has one core purpose: make the host assistant follow a reliable long-form novel workflow while keeping all generated output as Markdown/JSON files in the user's workspace.

It should let a user say something like:

> Help me generate a novel. Create the setting, architecture, and first three chapters in this workspace.

The host assistant supplies the language model. The Novel Agent Core supplies workflow control, prompt scaffolding, state management, validation, context assembly, and Markdown/JSON file output. The MCP adapter is the first integration surface for Claude Code and Codex CLI, but it is not the whole product.

This is not a refactor of the current web backend. The current `books_manage` project remains the reference implementation for long-form fiction workflows. The new agent should be a smaller package that borrows the product ideas but does not depend on Express, SQLite, login, SSE, or configured model providers.

## 2. Scope

The first version should support:

- Creating a local novel project from a user prompt.
- Generating and saving novel metadata.
- Generating and saving story bible content.
- Generating and saving full-book, volume, and chapter architecture.
- Generating the first N chapters, where N is requested by the user or capped by the agent.
- Extracting a memory card for each generated chapter.
- Running a basic continuity review across generated chapters.
- Exporting all work as Markdown and JSON files in the user's workspace.

The kit should work without:

- User login.
- A web frontend.
- A local Express API.
- A database.
- DeepSeek, Zhipu, Minimax, OpenAI, Anthropic, or other provider keys configured inside the package.
- A server-side model call made by the core, CLI, or MCP adapter.

## 3. Non-Goals

This project should not initially include:

- Multi-user permissions.
- SaaS deployment.
- Publishing platform automation.
- Browser automation.
- Direct import into the existing web app.
- A full replacement for the current `books_manage` frontend.
- A hidden model runtime inside the core, CLI, or MCP adapter.

The host assistant, not the agent kit, is responsible for generating prose and structured content.

## 4. Architecture: Agent Core Plus Adapters

The project should be designed as an agent core with adapters:

```text
Novel Agent Core
  - workflow state machine
  - schemas
  - prompt templates
  - validators
  - context builder
  - file project store

Adapters
  - MCP adapter for Claude Code, Codex CLI, and other MCP hosts
  - CLI adapter for direct shell usage and testing
  - prompt-only instructions for lightweight manual use
```

The Agent Core owns the novel workflow. It should not know whether it is being called by MCP, CLI, tests, or a future UI.

The MCP adapter owns protocol details: tool registration, resource exposure, prompt exposure, and request/response mapping. It should call core functions rather than implement workflow logic itself.

The CLI adapter is useful for development and fallback usage. It should expose commands such as `start`, `next`, `submit`, and `context`, backed by the same core functions.

## 5. Key Constraint: The Agent Kit Does Not Own The Model

The Agent Core and adapters should not assume they can call the Claude Code or Codex CLI model directly. Instead, they should use a host-agent loop:

1. Adapter returns the next generation instruction, expected output schema, and relevant context.
2. The host assistant generates the requested content using its own model.
3. The host assistant submits the generated result back through an adapter call.
4. Agent Core validates, saves files, updates state, and returns the next step.

This keeps token usage inside the user's chosen AI tool and keeps the agent kit provider-neutral.

## 6. Proposed Package Layout

```text
novelforge-agent/
  package.json
  src/
    core/
      projectStore.ts
      workflow.ts
      schemas.ts
      contextBuilder.ts
      validators.ts
      fileNames.ts
    mcp/
      server.ts
      tools.ts
      prompts.ts
      resources.ts
    cli/
      index.ts
  templates/
    prompts/
      novel-metadata.md
      story-bible.md
      architecture.md
      chapter.md
      memory-card.md
      continuity-review.md
    instructions/
      claude.md
      codex.md
  test/
    workflow.test.ts
    project-store.test.ts
    validators.test.ts
```

The package may live in this repository under a new top-level `novelforge-agent/` directory or be split into a new repository later. For the first iteration, keeping it in this repository is useful because existing workflow documents and backend graph files can be referenced while designing prompts and state transitions.

## 7. File Output Format

Each generated novel project should be stored as normal files:

```text
novels/
  <slug>/
    novel.json
    outline.md
    story-bible.md
    agent-state.json
    architecture/
      full.md
      volumes.json
      chapters.json
    chapters/
      001.md
      002.md
      003.md
    memory/
      chapter-001.json
      chapter-002.json
      chapter-003.json
    reviews/
      continuity-001-003.json
```

`agent-state.json` is internal workflow state. It records the current step, completed steps, project metadata, chapter count, known file paths, validation errors, and timestamps.

The user-facing files should remain readable and editable without the agent. Markdown files carry prose and outlines. JSON files carry structured data that the agent needs for future context assembly.

## 8. Workflow

The MVP workflow is linear, with resumable checkpoints:

1. `start_novel_project`
   - Create project directory.
   - Save initial prompt and constraints.
   - Initialize `agent-state.json`.
   - Return the metadata generation instruction.

2. `submit_step_result` for `novel_metadata`
   - Validate title, genre, premise, core cast, and style fields.
   - Save `novel.json`.
   - Return story bible generation instruction.

3. `submit_step_result` for `story_bible`
   - Save `story-bible.md`.
   - Optionally save structured story bible sections in state.
   - Return architecture generation instruction.

4. `submit_step_result` for `architecture`
   - Validate full-book, volume, and chapter architecture.
   - Save `architecture/full.md`, `architecture/volumes.json`, and `architecture/chapters.json`.
   - Return chapter generation instruction for chapter 1.

5. `submit_step_result` for each `chapter`
   - Save `chapters/NNN.md`.
   - Return memory card extraction instruction for that chapter.

6. `submit_step_result` for each `memory_card`
   - Validate summary, key events, entities, facts, state changes, and open threads.
   - Save `memory/chapter-NNN.json`.
   - Return the next chapter instruction or continuity review instruction.

7. `submit_step_result` for `continuity_review`
   - Save `reviews/continuity-START-END.json`.
   - Mark the MVP run complete.

Future versions can add branching for revision, expansion, import, and chapter continuation.

## 9. MCP Adapter Tools

The MCP adapter should expose the core workflow as tools. It should not duplicate workflow state handling or validation logic.

### `start_novel_project`

Inputs:

- `prompt`: user's raw novel request.
- `outputDir`: optional workspace-relative output directory.
- `targetChapters`: optional first-run chapter count.
- `language`: optional, default inferred from user prompt.
- `styleConstraints`: optional free-form string.

Output:

- `projectId`
- `projectPath`
- `currentStep`
- `instruction`
- `expectedFormat`
- `context`

### `get_next_step`

Inputs:

- `projectPath`

Output:

- Current incomplete step.
- Instruction to give the host assistant.
- Expected schema or Markdown format.
- Relevant context.

### `submit_step_result`

Inputs:

- `projectPath`
- `step`
- `content`
- `metadata`: optional object for tool-specific fields.

Output:

- Validation result.
- Saved file paths.
- Updated workflow state.
- Next step instruction, if any.

### `get_context`

Inputs:

- `projectPath`
- `purpose`: `chapter_generation`, `memory_extraction`, `continuity_review`, or `revision`.
- `chapterNumber`: optional.

Output:

- Condensed context assembled from novel metadata, story bible, architecture, previous chapter memory, and relevant prior chapters.

### `save_chapter`

Inputs:

- `projectPath`
- `chapterNumber`
- `title`
- `content`

Output:

- Saved chapter path.
- Suggested next memory-card step.

This tool is useful when the host assistant has directly generated a chapter outside the strict `submit_step_result` loop.

### `review_continuity`

Inputs:

- `projectPath`
- `chapterRange`

Output:

- Review instruction.
- Relevant context.
- Expected review schema.

The host assistant writes the review. MCP stores it through `submit_step_result`.

### `export_project`

Inputs:

- `projectPath`

Output:

- Summary of generated files.
- Optional combined Markdown path.

## 10. MCP Resources And Prompts

The MCP adapter should expose project files as MCP resources so the host assistant can inspect them without guessing paths:

- `novel://<projectId>/metadata`
- `novel://<projectId>/story-bible`
- `novel://<projectId>/architecture`
- `novel://<projectId>/chapter/<number>`
- `novel://<projectId>/memory/<number>`
- `novel://<projectId>/state`

It should also expose reusable prompts:

- `novel_generate_metadata`
- `novel_generate_story_bible`
- `novel_generate_architecture`
- `novel_generate_chapter`
- `novel_extract_memory_card`
- `novel_review_continuity`

These prompts are templates. They do not call a model themselves.

## 11. CLI Adapter

The CLI adapter should provide the same capability without MCP:

```text
novelforge-agent start --prompt "..." --chapters 3
novelforge-agent next <projectPath>
novelforge-agent submit <projectPath> --step novel_metadata --file result.json
novelforge-agent context <projectPath> --purpose chapter_generation --chapter 1
novelforge-agent export <projectPath>
```

The CLI is not the primary user experience for Claude Code or Codex CLI, but it gives the project a simple debugging surface and makes automated tests easier to reason about.

## 12. Validation Rules

Validation should be strict for JSON and forgiving for Markdown.

JSON validation should check:

- Required fields exist.
- Chapter numbers are positive integers.
- Arrays are arrays, not stringified JSON.
- Architecture chapter count matches requested first-run range where applicable.
- Memory cards include summary, key events, entities, facts, state changes, and open threads.

Markdown validation should check:

- Content is non-empty.
- Chapter files contain a title and body.
- No accidental JSON-only output appears where prose was expected.

Validation failures should not discard content. The agent should save invalid submissions to a recovery file such as:

```text
.agent-recovery/
  failed-step-<timestamp>.txt
```

Then it should return a repair instruction to the host assistant.

## 13. Context Strategy

The agent should avoid dumping the entire project into every generation request. Context should be assembled by purpose.

For chapter generation, include:

- Novel metadata.
- Relevant story bible summary.
- Full-book architecture summary.
- Current chapter architecture.
- Previous chapter ending.
- Previous chapter memory card.
- Open threads from recent memory cards.
- User style constraints.

For memory extraction, include:

- Current chapter content.
- Novel metadata.
- Current chapter architecture.

For continuity review, include:

- Chapter architecture list.
- Memory cards for the selected range.
- Chapter endings and beginnings.
- Key facts and state changes.

This keeps prompts manageable and preserves space for generation.

## 14. Error Handling

The Agent Core should be deterministic and fail closed:

- If `projectPath` is outside the current workspace, reject it.
- If a required file is missing, return a repairable workflow error.
- If JSON is invalid, save the raw content and ask the host assistant to repair it.
- If the workflow state and files disagree, prefer files as the source of truth and rebuild state when possible.
- If a chapter already exists, require explicit overwrite metadata or create a versioned backup.

No tool should silently delete generated prose.

## 15. Relationship To Current Project

The current `books_manage` backend remains useful as a reference for:

- Novel bootstrap workflow.
- Architecture hierarchy.
- Chapter memory card fields.
- Continuity review concepts.
- Revision workflow ideas.

The pure agent kit should not import current backend modules directly in the MVP. Direct imports would bring in database, model-provider, and web-service dependencies that conflict with the clean local tool goal.

## 16. MVP Acceptance Criteria

The MVP is complete when:

- A user can install or run the agent kit locally.
- Claude Code or Codex CLI can call the MCP adapter tools.
- The CLI adapter can exercise the same core workflow.
- A prompt can create a novel project under `novels/<slug>/`.
- The agent can guide generation of metadata, story bible, architecture, and at least three chapters.
- Generated files are valid Markdown/JSON.
- The workflow can resume after restarting the MCP adapter or CLI process.
- No model API key is required by the agent kit.
- No login is required.

## 17. Testing Plan

Automated tests should cover:

- Project initialization and safe path handling.
- Workflow state transitions.
- JSON schema validation.
- Context assembly for chapter generation.
- File naming and overwrite behavior.
- Recovery file creation on invalid submissions.

Manual verification should cover:

- Running the MCP adapter from a local checkout.
- Calling the MCP tools through a host assistant.
- Running the same workflow through CLI commands.
- Generating a small novel project with metadata, story bible, architecture, three chapters, memory cards, and a continuity review.

## 18. Recommended First Implementation Slice

Start with the smallest useful loop:

1. Create `novelforge-agent/`.
2. Implement project store and file layout.
3. Implement `start_novel_project`.
4. Implement `get_next_step`.
5. Implement `submit_step_result`.
6. Add metadata, story bible, architecture, chapter, memory, and continuity prompts.
7. Add the MCP adapter that maps tools to the core.
8. Add the CLI adapter for local debugging.
9. Add tests for state transitions, validation, and adapter/core boundaries.

After this slice works, add resources, richer context assembly, chapter continuation, and optional revision workflows.
