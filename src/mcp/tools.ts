import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  amendNovelMetadata,
  amendStoryBible,
  assertProjectPath,
  buildContext,
  createProject,
  deleteChapter,
  forkProject,
  getNextStep,
  getArtifactSummary,
  listAgentRuns,
  getProjectStatus,
  listProjects,
  listStoryBibleVersions,
  loadState,
  loadThreads,
  readAgentEvents,
  redoStep,
  requestSideTrack,
  retrieve,
  summarizeForLog,
  submitStepResult,
  tryAppendAgentEvent,
  updateThread,
} from '../core/index.js';
import type { AgentState, StepInstruction, SubmitStepResult } from '../core/index.js';

function packageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version) return parsed.version;
    } catch {
      // keep walking upward until the package root is found
    }

    const parent = dirname(dir);
    if (parent === dir) return '0.0.0';
    dir = parent;
  }
}

const MCP_SERVER_VERSION = packageVersion();
const MCP_CONTEXT_PREVIEW_CHARS = 8_000;

export interface CreateNovelAgentServerOptions {
  workspaceRoot: string;
}

function textResult(value: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

type TextToolResult = ReturnType<typeof textResult>;

function safeLabel(label: string): string {
  return label.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'context';
}

async function saveMcpPayload(projectPath: string, label: string, value: unknown): Promise<string> {
  const dir = join(projectPath, '.agent-recovery', 'mcp-context');
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `${timestamp}-${safeLabel(label)}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

async function boundContext(projectPath: string, label: string, context: string, extra: Record<string, unknown> = {}) {
  if (context.length <= MCP_CONTEXT_PREVIEW_CHARS) {
    return {
      ...extra,
      context,
      contextLength: context.length,
      contextTruncated: false,
    };
  }

  const fullContextPath = await saveMcpPayload(projectPath, label, { ...extra, context });
  return {
    ...extra,
    contextPreview: context.slice(0, MCP_CONTEXT_PREVIEW_CHARS),
    contextLength: context.length,
    contextPreviewLength: MCP_CONTEXT_PREVIEW_CHARS,
    contextTruncated: true,
    fullContextPath,
    truncationHint: 'The full context was too large for an MCP tool result. Read fullContextPath when exact full context is needed.',
  };
}

async function boundInstruction(instruction: StepInstruction) {
  const base = {
    projectId: instruction.projectId,
    projectPath: instruction.projectPath,
    currentStep: instruction.currentStep,
    expectedFormat: instruction.expectedFormat,
  };
  const instructionTruncated = instruction.instruction.length > MCP_CONTEXT_PREVIEW_CHARS;
  const contextTruncated = instruction.context.length > MCP_CONTEXT_PREVIEW_CHARS;

  if (!instructionTruncated && !contextTruncated) {
    return {
      ...base,
      instruction: instruction.instruction,
      instructionLength: instruction.instruction.length,
      instructionTruncated: false,
      context: instruction.context,
      contextLength: instruction.context.length,
      contextTruncated: false,
    };
  }

  const fullContextPath = await saveMcpPayload(instruction.projectPath, `next-step-${instruction.currentStep}`, {
    ...base,
    instruction: instruction.instruction,
    context: instruction.context,
  });

  return {
    ...base,
    ...(instructionTruncated ? {
      instructionPreview: instruction.instruction.slice(0, MCP_CONTEXT_PREVIEW_CHARS),
      instructionLength: instruction.instruction.length,
      instructionPreviewLength: MCP_CONTEXT_PREVIEW_CHARS,
      instructionTruncated: true,
    } : {
      instruction: instruction.instruction,
      instructionLength: instruction.instruction.length,
      instructionTruncated: false,
    }),
    ...(contextTruncated ? {
      contextPreview: instruction.context.slice(0, MCP_CONTEXT_PREVIEW_CHARS),
      contextLength: instruction.context.length,
      contextPreviewLength: MCP_CONTEXT_PREVIEW_CHARS,
      contextTruncated: true,
    } : {
      context: instruction.context,
      contextLength: instruction.context.length,
      contextTruncated: false,
    }),
    fullContextPath,
    truncationHint: 'The full instruction/context was too large for an MCP tool result. Read fullContextPath when exact full payload is needed.',
  };
}

function compactState(state: AgentState) {
  return {
    projectId: state.projectId,
    projectPath: state.projectPath,
    currentStep: state.currentStep,
    currentChapter: state.currentChapter,
    targetChapters: state.targetChapters,
    plannedTotalChapters: state.plannedTotalChapters,
    completedSteps: state.completedSteps,
    files: state.files,
    pendingAction: state.pendingAction,
    updatedAt: state.updatedAt,
  };
}

function compactSubmitResult(result: SubmitStepResult) {
  return {
    validation: result.validation,
    state: compactState(result.state),
    savedPaths: result.savedPaths,
    recoveryPath: result.recoveryPath,
    next: result.next ? {
      projectId: result.next.projectId,
      projectPath: result.next.projectPath,
      currentStep: result.next.currentStep,
      expectedFormat: result.next.expectedFormat,
      instructionLength: result.next.instruction.length,
      contextLength: result.next.context.length,
      hint: 'Call get_next_step with this projectPath when you need the next full instruction and context.',
    } : undefined,
  };
}

function pathFromObject(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of ['projectPath', 'sourceProjectPath', 'newProjectPath', 'oldProjectPath']) {
    if (typeof obj[key] === 'string') return obj[key];
  }
  if (obj.state && typeof obj.state === 'object') {
    const statePath = (obj.state as Record<string, unknown>).projectPath;
    if (typeof statePath === 'string') return statePath;
  }
  if (obj.next && typeof obj.next === 'object') {
    const nextPath = (obj.next as Record<string, unknown>).projectPath;
    if (typeof nextPath === 'string') return nextPath;
  }
  return undefined;
}

function projectPathFromTextResult(value: unknown): string | undefined {
  const direct = pathFromObject(value);
  if (direct) return direct;
  try {
    const text = (value as { content?: Array<{ text?: string }> }).content?.[0]?.text;
    if (!text) return undefined;
    return pathFromObject(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export function createNovelAgentServer(options: CreateNovelAgentServerOptions): McpServer {
  function checkedProjectPath(projectPath: string): string {
    assertProjectPath(options.workspaceRoot, projectPath);
    return projectPath;
  }

  function checkedOutputDir(outputDir: string): string {
    assertProjectPath(options.workspaceRoot, resolve(options.workspaceRoot, outputDir));
    return outputDir;
  }

  function logProjectPath(projectPath: string | undefined): string | undefined {
    if (!projectPath) return undefined;
    try {
      assertProjectPath(options.workspaceRoot, projectPath);
      return projectPath;
    } catch {
      return undefined;
    }
  }

  const server = new McpServer({
    name: 'novelforge-agent',
    version: MCP_SERVER_VERSION,
  });

  function tool(
    name: string,
    description: string,
    paramsSchema: Record<string, z.ZodTypeAny>,
    handler: (args: any) => Promise<TextToolResult>
  ) {
    server.tool(name, description, paramsSchema, async (args: any) => {
      const runId = randomUUID();
      const startedAt = Date.now();
      const startedAtIso = new Date(startedAt).toISOString();
      const inputProjectPath = logProjectPath(pathFromObject(args));
      const startEvent = {
        type: 'tool_call_start',
        ts: startedAtIso,
        runId,
        tool: name,
        inputSummary: summarizeForLog(args),
      };
      await tryAppendAgentEvent(inputProjectPath, startEvent);

      try {
        const result = await handler(args);
        const outputProjectPath = logProjectPath(projectPathFromTextResult(result)) ?? inputProjectPath;
        if (!inputProjectPath) await tryAppendAgentEvent(outputProjectPath, startEvent);
        await tryAppendAgentEvent(outputProjectPath, {
          type: 'tool_call_end',
          runId,
          tool: name,
          durationMs: Date.now() - startedAt,
          outputSummary: summarizeForLog(result),
        });
        return result;
      } catch (error) {
        await tryAppendAgentEvent(inputProjectPath, {
          type: 'tool_call_error',
          level: 'error',
          runId,
          tool: name,
          durationMs: Date.now() - startedAt,
          error: {
            name: (error as Error).name,
            message: (error as Error).message,
          },
        });
        throw error;
      }
    });
  }

  tool(
    'start_novel_project',
    'Create a local novel project and return the first generation instruction.',
    {
      prompt: z.string().min(1),
      language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
      outputDir: z.string().default('novels'),
      targetChapters: z.number().int().positive().default(5),
      plannedTotalChapters: z.number().int().positive().default(12),
    },
    async ({ prompt, language, outputDir, targetChapters, plannedTotalChapters }) => {
      const result = await createProject({
        workspaceRoot: options.workspaceRoot,
        prompt,
        language,
        outputDir,
        targetChapters,
        plannedTotalChapters,
      });
      return textResult({ state: result.state, next: await boundInstruction(await getNextStep(result.state.projectPath)) });
    }
  );

  tool(
    'list_projects',
    'List all NovelForge projects under the workspace, sorted by most recently updated. Use this to find an existing projectPath instead of asking the user.',
    {
      outputDir: z.string().default('novels'),
    },
    async ({ outputDir }) =>
      textResult(await listProjects({ workspaceRoot: options.workspaceRoot, outputDir: checkedOutputDir(outputDir) }))
  );

  tool(
    'get_project_status',
    'Return a compact, one-screen summary of a project: current step, chapters written, open threads, latest review verdict, completion state.',
    { projectPath: z.string().min(1) },
    async ({ projectPath }) => textResult(await getProjectStatus(checkedProjectPath(projectPath)))
  );

  tool(
    'amend_novel_metadata',
    'Update novel.json metadata. If title changes, the project directory is renamed and the returned projectPath must be used afterward.',
    {
      projectPath: z.string().min(1),
      content: z.string().optional(),
      title: z.string().min(1).optional(),
      genre: z.string().min(1).optional(),
      premise: z.string().min(1).optional(),
      language: z.string().min(1).optional(),
      style: z.string().min(1).optional(),
      coreCast: z.array(z.object({
        name: z.string().min(1),
        role: z.string().min(1),
        description: z.string().min(1),
      })).optional(),
      reason: z.string().optional(),
    },
    async ({ projectPath, content, title, genre, premise, language, style, coreCast, reason }) => {
      const result = await amendNovelMetadata({
        projectPath: checkedProjectPath(projectPath),
        content,
        title,
        genre,
        premise,
        language,
        style,
        coreCast,
        reason,
      });
      return textResult({
        ...result,
        hint: result.renamed
          ? 'The project directory was renamed. Use projectPath from this result for all subsequent NovelForge calls.'
          : 'Metadata updated. Continue using the returned projectPath.',
      });
    }
  );

  tool(
    'get_next_step',
    'Return the next required generation step for a novel project. Large prompts/contexts are returned as previews plus fullContextPath.',
    { projectPath: z.string().min(1) },
    async ({ projectPath }) => textResult(await boundInstruction(await getNextStep(checkedProjectPath(projectPath))))
  );

  tool(
    'submit_step_result',
    'Submit host-generated content for validation, saving, and workflow advancement. Returns a compact mutation result; call get_next_step afterward when the next full instruction and context are needed.',
    {
      projectPath: z.string().min(1),
      step: z.enum([
        'novel_metadata',
        'story_bible',
        'style_guide',
        'architecture',
        'architecture_extension',
        'chapter',
        'memory_card',
        'continuity_review',
        'chapter_review',
        'chapter_revision',
        'cross_chapter_review',
        'complete',
      ]),
      content: z.string(),
    },
    async ({ projectPath, step, content }) =>
      textResult(compactSubmitResult(await submitStepResult({ projectPath: checkedProjectPath(projectPath), step, content })))
  );

  tool(
    'get_context',
    'Build purpose-specific context for generation, memory extraction, review, or revision. Large contexts are returned as a preview plus fullContextPath.',
    {
      projectPath: z.string().min(1),
      purpose: z.enum([
        'chapter_generation',
        'style_guide',
        'architecture_extension',
        'memory_extraction',
        'continuity_review',
        'revision',
        'chapter_review',
        'cross_chapter_review',
      ]),
      chapterNumber: z.number().int().positive().optional(),
      start: z.number().int().positive().optional(),
      end: z.number().int().positive().optional(),
    },
    async ({ projectPath, purpose, chapterNumber, start, end }) => {
      const checked = checkedProjectPath(projectPath);
      const range = start && end ? { start, end } : undefined;
      const context = await buildContext({
        projectPath: checked,
        purpose,
        chapterNumber,
        range,
      });
      return textResult(await boundContext(checked, `context-${purpose}`, context, { projectPath: checked, purpose, chapterNumber, range }));
    }
  );

  tool(
    'save_chapter',
    'Submit a generated chapter Markdown draft through the workflow state machine. This requires currentStep="chapter" and advances to chapter_review. Returns a compact mutation result; call get_next_step afterward for the review prompt/context.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      title: z.string().min(1),
      content: z.string().min(1),
    },
    async ({ projectPath, chapterNumber, title, content }) => {
      const checked = checkedProjectPath(projectPath);
      const state = await loadState(checked);
      if (state.currentStep !== 'chapter' || state.currentChapter !== chapterNumber) {
        throw new Error(
          `save_chapter requires currentStep="chapter" and currentChapter=${chapterNumber}; got currentStep="${state.currentStep}", currentChapter=${state.currentChapter}`
        );
      }
      return textResult(compactSubmitResult(await submitStepResult({
        projectPath: checked,
        step: 'chapter',
        content: `# ${title}\n\n${content}`,
      })));
    }
  );

  tool(
    'generate_chapter',
    'Build the chapter-generation context and instruction for a specific chapter without changing workflow state. Large contexts are returned as a preview plus fullContextPath.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
    },
    async ({ projectPath, chapterNumber }) => {
      const checked = checkedProjectPath(projectPath);
      const context = await buildContext({ projectPath: checked, purpose: 'chapter_generation', chapterNumber });
      return textResult(await boundContext(checked, `generate-chapter-${chapterNumber}`, context, {
        projectPath: checked,
        chapterNumber,
        hint: 'Persist the result via submit_step_result(step="chapter") when the workflow currentStep is "chapter"; the workflow then requires chapter_review before memory_card.',
      }));
    }
  );

  tool(
    'extract_memory_card',
    'Build the memory-extraction context for a specific chapter without changing workflow state. Large contexts are returned as a preview plus fullContextPath.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
    },
    async ({ projectPath, chapterNumber }) => {
      const checked = checkedProjectPath(projectPath);
      const context = await buildContext({ projectPath: checked, purpose: 'memory_extraction', chapterNumber });
      return textResult(await boundContext(checked, `memory-extraction-${chapterNumber}`, context, {
        projectPath: checked,
        chapterNumber,
        hint: 'Submit the extracted memory card via submit_step_result with step="memory_card" when the workflow currentStep matches.',
      }));
    }
  );

  tool(
    'review_chapter',
    'Ask the host to review a specific chapter. Switches into chapter_review side-track and returns its prompt + packed context. Large prompts/contexts are returned as previews plus fullContextPath.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
    },
    async ({ projectPath, chapterNumber }) =>
      textResult(await boundInstruction(await requestSideTrack({ projectPath: checkedProjectPath(projectPath), step: 'chapter_review', chapterNumber })))
  );

  tool(
    'revise_chapter',
    'Ask the host to rewrite a specific chapter based on prior review feedback and optional extra instructions. Large prompts/contexts are returned as previews plus fullContextPath. Previous version is archived under chapters/.versions/.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      feedback: z.string().optional(),
    },
    async ({ projectPath, chapterNumber, feedback }) =>
      textResult(await boundInstruction(await requestSideTrack({ projectPath: checkedProjectPath(projectPath), step: 'chapter_revision', chapterNumber, feedback })))
  );

  tool(
    'retrieve',
    'Lexical BM25-style retrieval over indexed chapter paragraphs, story-bible sections, and memory cards. Returns ranked snippets with chapter attribution.',
    {
      projectPath: z.string().min(1),
      query: z.string().min(1),
      topK: z.number().int().positive().max(50).default(6),
      types: z.array(z.enum(['chapter', 'bible', 'memory'])).optional(),
      chapterStart: z.number().int().positive().optional(),
      chapterEnd: z.number().int().positive().optional(),
    },
    async ({ projectPath, query, topK, types, chapterStart, chapterEnd }) => {
      const chapterRange = chapterStart && chapterEnd ? { start: chapterStart, end: chapterEnd } : undefined;
      const hits = await retrieve(checkedProjectPath(projectPath), query, { topK, types, chapterRange });
      return textResult({ query, hits });
    }
  );

  tool(
    'cross_chapter_review',
    'Ask the host to review a chapter range for cross-chapter continuity conflicts. Defaults to all generated chapters. Large prompts/contexts are returned as previews plus fullContextPath.',
    {
      projectPath: z.string().min(1),
      start: z.number().int().positive().optional(),
      end: z.number().int().positive().optional(),
    },
    async ({ projectPath, start, end }) => {
      const range = start && end ? { start, end } : undefined;
      return textResult(await boundInstruction(await requestSideTrack({ projectPath: checkedProjectPath(projectPath), step: 'cross_chapter_review', range })));
    }
  );

  // ----- v0.2 tools -----

  tool(
    'amend_story_bible',
    'Replace the story bible with a revised version. Old version is auto-archived under story-bible-versions/ and the lexical index is rebuilt for the new content.',
    {
      projectPath: z.string().min(1),
      content: z.string().min(1),
      reason: z.string().optional(),
    },
    async ({ projectPath, content, reason }) =>
      textResult(await amendStoryBible({ projectPath: checkedProjectPath(projectPath), content, reason }))
  );

  tool(
    'list_bible_versions',
    'List archived story-bible versions for a project (filenames sorted oldest first).',
    { projectPath: z.string().min(1) },
    async ({ projectPath }) => textResult({ versions: await listStoryBibleVersions(checkedProjectPath(projectPath)) })
  );

  tool(
    'list_threads',
    'List foreshadow threads for a project, optionally filtered by status. Threads are aggregated from memory_card.threadActions.',
    {
      projectPath: z.string().min(1),
      status: z.enum(['planted', 'building', 'paid', 'dropped']).optional(),
    },
    async ({ projectPath, status }) => {
      const all = await loadThreads(checkedProjectPath(projectPath));
      const filtered = status ? all.filter((t) => t.status === status) : all;
      return textResult({ threads: filtered });
    }
  );

  tool(
    'update_thread',
    'Update a single foreshadow thread (override status, plannedPayoffAt, paidOffAt, droppedAt, description, notes).',
    {
      projectPath: z.string().min(1),
      id: z.string().min(1),
      status: z.enum(['planted', 'building', 'paid', 'dropped']).optional(),
      plannedPayoffAt: z.number().int().positive().nullable().optional(),
      paidOffAt: z.number().int().positive().nullable().optional(),
      droppedAt: z.number().int().positive().nullable().optional(),
      description: z.string().min(1).optional(),
      notes: z.string().nullable().optional(),
    },
    async ({ projectPath, id, ...patch }) =>
      textResult(await updateThread(checkedProjectPath(projectPath), id, patch))
  );

  tool(
    'fork_project',
    'Copy an existing project to a new sibling directory with a new projectId. Use to try alternate plot branches without losing the original.',
    {
      sourceProjectPath: z.string().min(1),
      label: z.string().optional(),
    },
    async ({ sourceProjectPath, label }) =>
      textResult(await forkProject({ sourceProjectPath: checkedProjectPath(sourceProjectPath), label }))
  );

  tool(
    'delete_chapter',
    'Delete a chapter, its memory card, its single-chapter review, and all archived versions. Removes the chapter from the lexical index and rewinds the workflow if needed.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
    },
    async ({ projectPath, chapterNumber }) =>
      textResult(await deleteChapter({ projectPath: checkedProjectPath(projectPath), chapterNumber }))
  );

  tool(
    'redo_step',
    'Roll the workflow back to a specific step. Files produced by that step (and dependent chapter content for chapter/memory_card steps) are removed; the host must regenerate.',
    {
      projectPath: z.string().min(1),
      step: z.enum([
        'novel_metadata',
        'story_bible',
        'style_guide',
        'architecture',
        'chapter',
        'memory_card',
        'continuity_review',
      ]),
      chapterNumber: z.number().int().positive().optional(),
    },
    async ({ projectPath, step, chapterNumber }) =>
      textResult(await redoStep({ projectPath: checkedProjectPath(projectPath), step, chapterNumber }))
  );

  tool(
    'get_recent_events',
    'Return recent compact audit events for a project. Large text payloads are summarized by length and sha256 instead of echoed.',
    {
      projectPath: z.string().min(1),
      limit: z.number().int().positive().max(500).default(50),
      type: z.string().optional(),
    },
    async ({ projectPath, limit, type }) =>
      textResult({ events: await readAgentEvents(checkedProjectPath(projectPath), { limit, type }) })
  );

  tool(
    'list_runs',
    'List recent MCP tool runs for a project, grouped by runId with status and duration.',
    {
      projectPath: z.string().min(1),
      limit: z.number().int().positive().max(200).default(50),
    },
    async ({ projectPath, limit }) =>
      textResult({ runs: await listAgentRuns(checkedProjectPath(projectPath), limit) })
  );

  tool(
    'get_run_log',
    'Return audit events for one MCP tool runId.',
    {
      projectPath: z.string().min(1),
      runId: z.string().min(1),
      limit: z.number().int().positive().max(500).default(100),
    },
    async ({ projectPath, runId, limit }) =>
      textResult({ events: await readAgentEvents(checkedProjectPath(projectPath), { runId, limit }) })
  );

  tool(
    'get_artifact_summary',
    'Return a compact checksum/size summary for a project artifact without exposing the full file content.',
    {
      projectPath: z.string().min(1),
      path: z.string().min(1),
    },
    async ({ projectPath, path }) =>
      textResult(await getArtifactSummary(checkedProjectPath(projectPath), path))
  );

  // ===== MCP Prompts (slash commands) =====

  server.prompt(
    'nf-start',
    'Start a brand new novel project under the configured workspace.',
    {
      prompt: z.string().describe('User idea / premise / genre, in any language.'),
      chapters: z.string().optional().describe('Planning batch size as a string. Defaults to 5.'),
      totalChapters: z.string().optional().describe('Whole-book target chapter count as a string. Defaults to 12.'),
    },
    ({ prompt, chapters, totalChapters }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server. Call start_novel_project with prompt="${prompt}", targetChapters=${chapters ?? '5'}, plannedTotalChapters=${totalChapters ?? '12'}, then enter the autonomous loop: read the current instruction/context, generate the requested content, call submit_step_result, then call get_next_step for the next full instruction/context unless currentStep is "complete". Show me the projectPath after start_novel_project returns.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-next',
    'Continue the current novelforge workflow by one step.',
    {
      projectPath: z.string().describe('Absolute path to the project.'),
    },
    ({ projectPath }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server. Call get_next_step with projectPath="${projectPath}". Read the returned instruction + context and produce the requested artifact, then call submit_step_result. The submit result is compact; call get_next_step again only if you need the next full instruction/context. Show me what step was advanced.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-list',
    'List all novelforge projects in the workspace.',
    {},
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: 'Use the novelforge MCP server: call list_projects with no arguments. Show me the result in a compact table (title, currentStep, chaptersWritten/plannedTotalChapters, updatedAt, projectPath).',
        },
      }],
    })
  );

  server.prompt(
    'nf-status',
    'Show a one-screen status for a novelforge project.',
    {
      projectPath: z.string(),
    },
    ({ projectPath }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call get_project_status with projectPath="${projectPath}". Summarize: title, current step, chapters written, open threads count, latest review verdict.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-review-chapter',
    'Run a single-chapter editorial review.',
    {
      projectPath: z.string(),
      chapterNumber: z.string(),
    },
    ({ projectPath, chapterNumber }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call review_chapter with projectPath="${projectPath}", chapterNumber=${chapterNumber}. Read the returned instruction + context, produce the JSON chapter review, then call submit_step_result with step="chapter_review". The submit result is compact; call get_next_step only if you need the resumed full instruction/context. Summarize the findings for me.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-revise-chapter',
    'Revise a chapter based on review feedback or new instructions.',
    {
      projectPath: z.string(),
      chapterNumber: z.string(),
      feedback: z.string().optional(),
    },
    ({ projectPath, chapterNumber, feedback }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call revise_chapter with projectPath="${projectPath}", chapterNumber=${chapterNumber}${feedback ? `, feedback=${JSON.stringify(feedback)}` : ''}. Read the returned instruction + context, produce the revised Markdown chapter, then call submit_step_result with step="chapter_revision". The submit result is compact; call get_next_step only if you need the next full instruction/context. Confirm the previous version was archived.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-cross-review',
    'Cross-chapter continuity review over a range.',
    {
      projectPath: z.string(),
      start: z.string().optional(),
      end: z.string().optional(),
    },
    ({ projectPath, start, end }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call cross_chapter_review with projectPath="${projectPath}"${start && end ? `, start=${start}, end=${end}` : ''}. Read the returned instruction + context, produce the JSON cross-chapter review, then call submit_step_result with step="cross_chapter_review". The submit result is compact; call get_next_step only if you need the resumed full instruction/context. Summarize verdict and any issues.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-retrieve',
    'Lexical retrieval over a project (BM25-style).',
    {
      projectPath: z.string(),
      query: z.string(),
    },
    ({ projectPath, query }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call retrieve with projectPath="${projectPath}", query=${JSON.stringify(query)}, topK=8. List the hits with chapter attribution and short excerpts.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-amend-bible',
    'Amend the story bible with new content (previous version auto-archived).',
    {
      projectPath: z.string(),
      reason: z.string().optional(),
    },
    ({ projectPath, reason }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server. First call get_project_status with projectPath="${projectPath}" to confirm the project exists, then read the current story-bible.md (you may use the host's filesystem tools). Apply the following amendment intent and produce a complete revised story bible Markdown:\n\n${reason ?? '(no specific reason supplied — ask the user what to change)'}\n\nThen call amend_story_bible with projectPath="${projectPath}" and the new content. Confirm the archived version path.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-threads',
    'Show active foreshadow threads for a project.',
    {
      projectPath: z.string(),
      status: z.enum(['planted', 'building', 'paid', 'dropped']).optional(),
    },
    ({ projectPath, status }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server: call list_threads with projectPath="${projectPath}"${status ? `, status="${status}"` : ''}. Show me the threads as a compact list: id, status, plantedAt, plannedPayoffAt (if set), description.`,
        },
      }],
    })
  );

  return server;
}
