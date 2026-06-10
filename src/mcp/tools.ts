import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  amendNovelMetadata,
  amendStoryBible,
  assertProjectPath,
  buildContext,
  continueProject,
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
  forceAdvanceChapter,
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

// =============================================================================
// Markdown-formatted tool result helper.
//
// Designed to:
//  - Reduce host-side token cost by replacing verbose JSON dumps with a
//    concise markdown summary that only contains the fields the host LLM
//    actually consumes (path / currentStep / instruction / expectedFormat).
//  - Keep machine-readable details available behind a `verbose=true` flag,
//    rendered as a fenced JSON block so programmatic hosts can still parse.
//  - Stay backward-compatible: existing JSON-dump callers can opt back in.
// =============================================================================

export interface ToolResultBullet {
  icon?: string;
  label?: string;
  value: string;
}

export interface ToolResultSection {
  heading: string;
  body: string;
  language?: string;
}

export interface FormatToolResultInput {
  status?: 'success' | 'error' | 'info';
  title: string;
  bullets?: ToolResultBullet[];
  sections?: ToolResultSection[];
  verbose?: boolean;
  /** Original full data — appended as a fenced JSON block when verbose=true. */
  rawForVerbose?: unknown;
}

function statusIcon(status: 'success' | 'error' | 'info' = 'success'): string {
  if (status === 'error') return '❌';
  if (status === 'info') return 'ℹ️';
  return '✓';
}

function renderBullet(b: ToolResultBullet): string {
  const head = b.icon ? `${b.icon} ` : '';
  const label = b.label ? `**${b.label}**: ` : '';
  return `- ${head}${label}${b.value}`;
}

function renderSection(s: ToolResultSection): string {
  const fence = s.language ? `\n\n\`\`\`${s.language}\n${s.body}\n\`\`\`\n` : `\n\n${s.body}\n`;
  return `### ${s.heading}${fence}`;
}

function formatToolResult(input: FormatToolResultInput) {
  const icon = statusIcon(input.status);
  const lines: string[] = [];
  lines.push(`${icon} **${input.title}**`);
  if (input.bullets && input.bullets.length > 0) {
    lines.push('');
    for (const b of input.bullets) lines.push(renderBullet(b));
  }
  if (input.sections && input.sections.length > 0) {
    for (const s of input.sections) {
      lines.push('');
      lines.push(renderSection(s));
    }
  }
  if (input.verbose && input.rawForVerbose !== undefined) {
    lines.push('');
    lines.push('### Raw');
    lines.push('```json');
    lines.push(JSON.stringify(input.rawForVerbose, null, 2));
    lines.push('```');
  }
  return {
    content: [{
      type: 'text' as const,
      text: lines.join('\n'),
    }],
  };
}

// =============================================================================
// Shared formatter for tools that return a `boundInstruction` shape
// (instruction + context + truncation hints + modelHint). Used by
// get_next_step, review_chapter, revise_chapter, cross_chapter_review.
// =============================================================================
function formatBoundInstruction(opts: {
  title: string;
  status?: 'info' | 'success';
  bound: Record<string, unknown> & { currentStep: string; expectedFormat: string };
  extraBullets?: ToolResultBullet[];
  verbose?: boolean;
}) {
  const b = opts.bound;
  const bullets: ToolResultBullet[] = [
    { icon: '⏭', label: 'Step', value: `\`${b.currentStep}\`` },
    { icon: '📝', label: 'Expected', value: b.expectedFormat },
  ];
  if (b.modelHint) bullets.push({ icon: '🤖', label: 'modelHint', value: String(b.modelHint) });
  const fullContextPath = b.fullContextPath as string | undefined;
  if (b.contextTruncated && fullContextPath) {
    bullets.push({ icon: '⚠️', label: 'Truncated', value: `full at \`${fullContextPath}\`` });
  }
  if (opts.extraBullets) bullets.push(...opts.extraBullets);
  const sections: ToolResultSection[] = [];
  const instrText = (b.instruction as string | undefined) ?? (b.instructionPreview as string | undefined);
  if (instrText) sections.push({ heading: 'Instruction', body: instrText });
  const ctxText = (b.context as string | undefined) ?? (b.contextPreview as string | undefined);
  if (ctxText) sections.push({ heading: 'Context', body: ctxText });
  return formatToolResult({
    status: opts.status ?? 'info',
    title: opts.title,
    bullets,
    sections,
    verbose: opts.verbose,
    rawForVerbose: b,
  });
}

// =============================================================================
// Shared formatter for tools that return a `boundContext` shape
// (context only, no instruction). Used by get_context, generate_chapter,
// extract_memory_card.
// =============================================================================
function formatBoundContext(opts: {
  title: string;
  bound: Record<string, unknown>;
  extraBullets?: ToolResultBullet[];
  hint?: string;
  verbose?: boolean;
}) {
  const b = opts.bound;
  const bullets: ToolResultBullet[] = [];
  const contextLength = b.contextLength as number | undefined;
  if (typeof contextLength === 'number') bullets.push({ icon: '📏', label: 'Context length', value: `${contextLength} chars` });
  const fullContextPath = b.fullContextPath as string | undefined;
  if (b.contextTruncated && fullContextPath) {
    bullets.push({ icon: '⚠️', label: 'Truncated', value: `full at \`${fullContextPath}\`` });
  }
  if (opts.hint) bullets.push({ icon: 'ℹ️', label: 'Hint', value: opts.hint });
  if (opts.extraBullets) bullets.push(...opts.extraBullets);
  const sections: ToolResultSection[] = [];
  const ctxText = (b.context as string | undefined) ?? (b.contextPreview as string | undefined);
  if (ctxText) sections.push({ heading: 'Context', body: ctxText });
  return formatToolResult({
    status: 'info',
    title: opts.title,
    bullets,
    sections,
    verbose: opts.verbose,
    rawForVerbose: b,
  });
}

// =============================================================================
// Shared formatter for tools that return a `compactSubmitResult` shape
// (state + savedPaths + next pointer). Used by submit_step_result success
// path and save_chapter.
// =============================================================================
function formatSubmitSuccess(opts: {
  title: string;
  compact: ReturnType<typeof compactSubmitResult>;
  verbose?: boolean;
}) {
  const compact = opts.compact;
  const bullets: ToolResultBullet[] = [
    { icon: '⏭', label: 'Now at', value: `\`${compact.state.currentStep}\`` },
  ];
  if (compact.state.currentChapter && compact.state.currentChapter > 0) {
    bullets.push({ icon: '📖', label: 'Chapter', value: String(compact.state.currentChapter) });
  }
  if (compact.savedPaths && compact.savedPaths.length > 0) {
    bullets.push({ icon: '💾', label: 'Saved', value: compact.savedPaths.map((p) => `\`${p}\``).join(', ') });
  }
  if (compact.next) {
    bullets.push({ icon: '➡️', label: 'Next', value: `\`${compact.next.currentStep}\` (${compact.next.expectedFormat})` });
    bullets.push({ icon: 'ℹ️', label: 'Hint', value: 'Call `get_next_step` for the next full instruction.' });
  }
  if (compact.state.forceAdvanced && compact.state.forceAdvanced.length > 0) {
    bullets.push({ icon: '⚠️', label: 'Force-advanced chapters', value: compact.state.forceAdvanced.join(', ') });
  }
  return formatToolResult({
    title: opts.title,
    bullets,
    verbose: opts.verbose,
    rawForVerbose: compact,
  });
}

function formatSubmitFailure(opts: {
  title: string;
  compact: ReturnType<typeof compactSubmitResult>;
  verbose?: boolean;
}) {
  const compact = opts.compact;
  const bullets: ToolResultBullet[] = [
    { icon: '⛔', label: 'Reason', value: compact.validation.message },
  ];
  if (compact.recoveryPath) bullets.push({ icon: '💾', label: 'Recovery', value: `\`${compact.recoveryPath}\`` });
  bullets.push({ icon: '⏭', label: 'Still at', value: `\`${compact.state.currentStep}\`` });
  bullets.push({ icon: '🔄', label: 'Action', value: 'Fix the content and re-submit.' });
  return formatToolResult({
    status: 'error',
    title: opts.title,
    bullets,
    verbose: opts.verbose,
    rawForVerbose: compact,
  });
}

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
    modelHint: instruction.modelHint,
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
    lengthPreset: state.lengthPreset,
    plannedTotalChapters: state.plannedTotalChapters,
    completedSteps: state.completedSteps,
    files: state.files,
    pendingAction: state.pendingAction,
    revisionCounts: state.revisionCounts,
    forceAdvanced: state.forceAdvanced,
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
  const text = (value as { content?: Array<{ text?: string }> }).content?.[0]?.text;
  if (!text) return undefined;
  // Tool results may be plain JSON, or markdown with a ```json fenced block
  // (verbose mode in formatToolResult). Try the fenced block first, then the
  // whole text as a fallback.
  const fenced = text.match(/```json\n([\s\S]*?)\n```/);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    try {
      const path = pathFromObject(JSON.parse(candidate));
      if (path) return path;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function resolveProjectFile(projectPath: string, inputPath: string): string {
  const target = isAbsolute(inputPath) ? resolve(inputPath) : resolve(projectPath, inputPath);
  const rel = relative(resolve(projectPath), target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to read content outside project: ${target}`);
  }
  return target;
}

async function contentFromInput(projectPath: string, content?: string, contentPath?: string): Promise<string> {
  if (content && contentPath) throw new Error('Provide either content or contentPath, not both.');
  if (content !== undefined) return content;
  if (contentPath) return readFile(resolveProjectFile(projectPath, contentPath), 'utf8');
  throw new Error('Either content or contentPath is required.');
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
    'Create a local novel project and return the first generation instruction. Returns a markdown summary by default; pass verbose=true for the full raw state JSON.',
    {
      prompt: z.string().min(1),
      language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
      outputDir: z.string().default('novels'),
      lengthPreset: z.enum(['short', 'medium', 'long']).default('medium'),
      targetChapters: z.number().int().positive().default(5),
      plannedTotalChapters: z.number().int().positive().optional(),
      chaptersPerRun: z.number().int().positive().default(1).describe('How many chapters to write in this invocation before pausing at complete. Default 1. Use continue_novel_project to resume for more chapters.'),
      verbose: z.boolean().default(false),
    },
    async ({ prompt, language, outputDir, lengthPreset, targetChapters, plannedTotalChapters, chaptersPerRun, verbose }) => {
      const result = await createProject({
        workspaceRoot: options.workspaceRoot,
        prompt,
        language,
        outputDir,
        lengthPreset,
        targetChapters,
        plannedTotalChapters,
        chaptersPerRun,
      });
      const next = await boundInstruction(await getNextStep(result.state.projectPath)) as Record<string, unknown> & {
        currentStep: string;
        expectedFormat: string;
      };
      const nextInstruction = (next.instruction as string | undefined) ?? (next.instructionPreview as string | undefined);
      return formatToolResult({
        title: 'Project created',
        bullets: [
          { icon: '📁', label: 'Path', value: `\`${result.state.projectPath}\`` },
          { icon: '🎯', label: 'Chapters', value: `${result.state.targetChapters} (first architecture batch) of ${result.state.plannedTotalChapters} planned${result.state.lengthPreset ? ` — ${result.state.lengthPreset}` : ''}` },
          { icon: '⏸', label: 'Per-run budget', value: `${result.state.chaptersPerRun ?? 1} chapter(s) — workflow will pause at \`complete\`; call \`continue_novel_project\` to write more` },
          { icon: '⏭', label: 'Next step', value: `\`${next.currentStep}\`` },
          { icon: '📝', label: 'Expected', value: next.expectedFormat },
        ],
        sections: [
          { heading: 'Instruction', body: nextInstruction ?? '(see fullContextPath in raw)' },
        ],
        verbose,
        rawForVerbose: { state: result.state, next },
      });
    }
  );

  tool(
    'list_projects',
    'List all NovelForge projects under the workspace, sorted by most recently updated. Use this to find an existing projectPath instead of asking the user.',
    {
      outputDir: z.string().default('novels'),
      verbose: z.boolean().default(false),
    },
    async ({ outputDir, verbose }) => {
      const projects = await listProjects({ workspaceRoot: options.workspaceRoot, outputDir: checkedOutputDir(outputDir) });
      if (projects.length === 0) {
        return formatToolResult({ status: 'info', title: `No projects in /${outputDir}` });
      }
      const rows = projects.map((p) => {
        const title = p.title ?? '(no title yet)';
        const progress = `${p.chaptersWritten}/${p.plannedTotalChapters ?? p.targetChapters}`;
        return `| ${title} | \`${p.currentStep}\` | ${progress} | \`${p.projectPath}\` |`;
      });
      const table = ['| Title | Step | Progress | Path |', '|---|---|---|---|', ...rows].join('\n');
      return formatToolResult({
        status: 'info',
        title: `Found ${projects.length} project${projects.length === 1 ? '' : 's'}`,
        sections: [{ heading: 'Projects', body: table }],
        verbose,
        rawForVerbose: projects,
      });
    }
  );

  tool(
    'get_project_status',
    'Return a compact, one-screen summary of a project: current step, chapters written, open threads, latest review verdict, completion state.',
    { projectPath: z.string().min(1), verbose: z.boolean().default(false) },
    async ({ projectPath, verbose }) => {
      const status = await getProjectStatus(checkedProjectPath(projectPath));
      const bullets: ToolResultBullet[] = [
        { icon: '📁', label: 'Path', value: `\`${status.projectPath}\`` },
        { icon: '⏭', label: 'Current step', value: `\`${status.currentStep}\`` },
        { icon: '📖', label: 'Chapters', value: `${status.chaptersWritten} / ${status.plannedTotalChapters}` },
        { icon: '✅', label: 'Completed steps', value: String(status.completedSteps) },
      ];
      if (status.openThreads && status.openThreads.length > 0) {
        bullets.push({ icon: '🧵', label: 'Open threads', value: `${status.openThreads.length} — ${status.openThreads.slice(0, 3).join('; ')}${status.openThreads.length > 3 ? '…' : ''}` });
      }
      if (status.forceAdvanced && status.forceAdvanced.length > 0) {
        bullets.push({ icon: '⚠️', label: 'Force-advanced chapters', value: status.forceAdvanced.join(', ') });
      }
      if (status.latestReview) {
        const r = status.latestReview;
        const detail = [r.type, r.status, r.chapterNumber ? `ch ${r.chapterNumber}` : r.range ? `${r.range.start}-${r.range.end}` : '', r.issueCount !== undefined ? `${r.issueCount} issues` : ''].filter(Boolean).join(', ');
        bullets.push({ icon: '📋', label: 'Latest review', value: detail });
      }
      if (status.done) {
        bullets.push({ icon: '🎉', label: 'Status', value: '**complete**' });
      }
      return formatToolResult({
        status: 'info',
        title: status.title ?? '(untitled)',
        bullets,
        verbose,
        rawForVerbose: status,
      });
    }
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
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, content, title, genre, premise, language, style, coreCast, reason, verbose }) => {
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
      const bullets: ToolResultBullet[] = [
        { icon: '📁', label: 'Path', value: `\`${result.projectPath}\`` },
        { icon: '💾', label: 'Saved', value: `\`${result.savedPath}\`` },
      ];
      if (result.renamed) {
        bullets.push({ icon: '⚠️', label: 'Renamed', value: `previously \`${result.oldProjectPath}\` — use the new projectPath above for all subsequent calls` });
      }
      return formatToolResult({
        title: result.renamed ? 'Metadata amended + project renamed' : 'Metadata amended',
        bullets,
        verbose,
        rawForVerbose: result,
      });
    }
  );

  tool(
    'get_next_step',
    'Return the next required generation step for a novel project. Large prompts/contexts are returned as previews plus fullContextPath.',
    { projectPath: z.string().min(1), verbose: z.boolean().default(false) },
    async ({ projectPath, verbose }) => {
      const bound = await boundInstruction(await getNextStep(checkedProjectPath(projectPath))) as Record<string, unknown> & {
        currentStep: string;
        expectedFormat: string;
      };
      return formatBoundInstruction({ title: 'Next step', bound, verbose });
    }
  );

  tool(
    'submit_step_result',
    'Submit host-generated content for validation, saving, and workflow advancement. Use contentPath for long chapter/review/memory payloads to avoid noisy tool-call input. Returns a compact markdown summary; call get_next_step afterward when the next full instruction and context are needed.',
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
      content: z.string().optional(),
      contentPath: z.string().min(1).optional(),
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, step, content, contentPath, verbose }) => {
      const checked = checkedProjectPath(projectPath);
      const resolvedContent = await contentFromInput(checked, content, contentPath);
      const result = await submitStepResult({ projectPath: checked, step, content: resolvedContent });
      const compact = compactSubmitResult(result);
      if (!compact.validation.ok) {
        return formatSubmitFailure({ title: `submit_step_result rejected (${step})`, compact, verbose });
      }
      return formatSubmitSuccess({ title: `${step} submitted`, compact, verbose });
    }
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
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, purpose, chapterNumber, start, end, verbose }) => {
      const checked = checkedProjectPath(projectPath);
      const range = start && end ? { start, end } : undefined;
      const context = await buildContext({
        projectPath: checked,
        purpose,
        chapterNumber,
        range,
      });
      const bound = await boundContext(checked, `context-${purpose}`, context, { projectPath: checked, purpose, chapterNumber, range });
      const extraBullets: ToolResultBullet[] = [
        { icon: '🎯', label: 'Purpose', value: purpose },
      ];
      if (chapterNumber) extraBullets.push({ icon: '📖', label: 'Chapter', value: String(chapterNumber) });
      if (range) extraBullets.push({ icon: '📏', label: 'Range', value: `${range.start}-${range.end}` });
      return formatBoundContext({
        title: 'get_context',
        bound: bound as Record<string, unknown>,
        extraBullets,
        verbose,
      });
    }
  );

  tool(
    'save_chapter',
    'Submit a generated chapter Markdown draft through the workflow state machine. Prefer contentPath for long chapters to avoid noisy tool-call input. This requires currentStep="chapter" and advances to chapter_review. Returns a compact mutation result; call get_next_step afterward for the review prompt/context.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      title: z.string().min(1),
      content: z.string().min(1).optional(),
      contentPath: z.string().min(1).optional(),
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, chapterNumber, title, content, contentPath, verbose }) => {
      const checked = checkedProjectPath(projectPath);
      const resolvedContent = await contentFromInput(checked, content, contentPath);
      const state = await loadState(checked);
      if (state.currentStep !== 'chapter' || state.currentChapter !== chapterNumber) {
        throw new Error(
          `save_chapter requires currentStep="chapter" and currentChapter=${chapterNumber}; got currentStep="${state.currentStep}", currentChapter=${state.currentChapter}`
        );
      }
      const compact = compactSubmitResult(await submitStepResult({
        projectPath: checked,
        step: 'chapter',
        content: `# ${title}\n\n${resolvedContent}`,
      }));
      if (!compact.validation.ok) {
        return formatSubmitFailure({ title: `save_chapter rejected (ch ${chapterNumber})`, compact, verbose });
      }
      return formatSubmitSuccess({ title: `Chapter ${chapterNumber} saved`, compact, verbose });
    }
  );

  tool(
    'generate_chapter',
    'Build the chapter-generation context and instruction for a specific chapter without changing workflow state. Large contexts are returned as a preview plus fullContextPath.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, chapterNumber, verbose }) => {
      const checked = checkedProjectPath(projectPath);
      const context = await buildContext({ projectPath: checked, purpose: 'chapter_generation', chapterNumber });
      const bound = await boundContext(checked, `generate-chapter-${chapterNumber}`, context, {
        projectPath: checked,
        chapterNumber,
        hint: 'Persist the result via submit_step_result(step="chapter") when the workflow currentStep is "chapter"; the workflow then requires chapter_review before memory_card.',
      });
      return formatBoundContext({
        title: `generate_chapter — chapter ${chapterNumber}`,
        bound: bound as Record<string, unknown>,
        extraBullets: [{ icon: '📖', label: 'Chapter', value: String(chapterNumber) }],
        hint: 'Submit via submit_step_result(step="chapter") when workflow currentStep is "chapter".',
        verbose,
      });
    }
  );

  tool(
    'extract_memory_card',
    'Build the memory-extraction context for a specific chapter without changing workflow state. Large contexts are returned as a preview plus fullContextPath.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, chapterNumber, verbose }) => {
      const checked = checkedProjectPath(projectPath);
      const context = await buildContext({ projectPath: checked, purpose: 'memory_extraction', chapterNumber });
      const bound = await boundContext(checked, `memory-extraction-${chapterNumber}`, context, {
        projectPath: checked,
        chapterNumber,
        hint: 'Submit the extracted memory card via submit_step_result with step="memory_card" when the workflow currentStep matches.',
      });
      return formatBoundContext({
        title: `extract_memory_card — chapter ${chapterNumber}`,
        bound: bound as Record<string, unknown>,
        extraBullets: [{ icon: '📖', label: 'Chapter', value: String(chapterNumber) }],
        hint: 'Submit via submit_step_result(step="memory_card") when workflow currentStep matches.',
        verbose,
      });
    }
  );

  tool(
    'review_chapter',
    'Ask the host to review a specific chapter. Switches into chapter_review side-track and returns its prompt + packed context. Large prompts/contexts are returned as previews plus fullContextPath.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, chapterNumber, verbose }) => {
      const bound = await boundInstruction(await requestSideTrack({ projectPath: checkedProjectPath(projectPath), step: 'chapter_review', chapterNumber })) as Record<string, unknown> & { currentStep: string; expectedFormat: string };
      return formatBoundInstruction({
        title: `Review chapter ${chapterNumber}`,
        bound,
        extraBullets: [{ icon: '📖', label: 'Chapter', value: String(chapterNumber) }],
        verbose,
      });
    }
  );

  tool(
    'revise_chapter',
    'Ask the host to rewrite a specific chapter based on prior review feedback and optional extra instructions. Large prompts/contexts are returned as previews plus fullContextPath. Previous version is archived under chapters/.versions/.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      feedback: z.string().optional(),
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, chapterNumber, feedback, verbose }) => {
      const bound = await boundInstruction(await requestSideTrack({ projectPath: checkedProjectPath(projectPath), step: 'chapter_revision', chapterNumber, feedback })) as Record<string, unknown> & { currentStep: string; expectedFormat: string };
      const extra: ToolResultBullet[] = [{ icon: '📖', label: 'Chapter', value: String(chapterNumber) }];
      if (feedback) extra.push({ icon: '💬', label: 'Feedback', value: feedback.length > 200 ? feedback.slice(0, 200) + '…' : feedback });
      return formatBoundInstruction({
        title: `Revise chapter ${chapterNumber}`,
        bound,
        extraBullets: extra,
        verbose,
      });
    }
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
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, start, end, verbose }) => {
      const range = start && end ? { start, end } : undefined;
      const bound = await boundInstruction(await requestSideTrack({ projectPath: checkedProjectPath(projectPath), step: 'cross_chapter_review', range })) as Record<string, unknown> & { currentStep: string; expectedFormat: string };
      const extra: ToolResultBullet[] = [];
      if (range) extra.push({ icon: '📏', label: 'Range', value: `${range.start}-${range.end}` });
      return formatBoundInstruction({ title: 'Cross-chapter review', bound, extraBullets: extra, verbose });
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
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, content, reason, verbose }) => {
      const result = await amendStoryBible({ projectPath: checkedProjectPath(projectPath), content, reason });
      const bullets: ToolResultBullet[] = [
        { icon: '📚', label: 'Bible version', value: String(result.bibleVersion) },
        { icon: '💾', label: 'Saved', value: `\`${result.savedPath}\`` },
      ];
      if (result.archivedPath) bullets.push({ icon: '🗄️', label: 'Archived prior', value: `\`${result.archivedPath}\`` });
      if (reason) bullets.push({ icon: '💬', label: 'Reason', value: reason });
      return formatToolResult({
        title: `Story bible amended (v${result.bibleVersion})`,
        bullets,
        verbose,
        rawForVerbose: result,
      });
    }
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
    'continue_novel_project',
    'Resume a project that paused at `complete` because its per-run chapter budget ran out. Rewinds the workflow to the next pending chapter (or architecture_extension if the planning batch is exhausted), resets the run start, and applies a new chaptersPerRun budget (default 1). If the book is genuinely finished (currentChapter exceeds plannedTotalChapters), returns alreadyAtEnd=true without changing state.',
    {
      projectPath: z.string().min(1),
      chaptersPerRun: z.number().int().positive().default(1).describe('How many additional chapters to generate before pausing again. Default 1.'),
      verbose: z.boolean().default(false),
    },
    async ({ projectPath, chaptersPerRun, verbose }) => {
      const checked = checkedProjectPath(projectPath);
      const result = await continueProject({ projectPath: checked, chaptersPerRun });
      if (result.alreadyAtEnd) {
        return formatToolResult({
          status: 'info',
          title: 'Project already at end',
          bullets: [
            { icon: '📁', label: 'Path', value: `\`${checked}\`` },
            { icon: '📖', label: 'Chapter', value: String(result.currentChapter) },
            { icon: '⏭', label: 'Current step', value: `\`${result.currentStep}\`` },
          ],
          verbose,
          rawForVerbose: result,
        });
      }
      const next = await boundInstruction(await getNextStep(checked)) as Record<string, unknown> & {
        currentStep: string;
        expectedFormat: string;
      };
      const nextInstruction = (next.instruction as string | undefined) ?? (next.instructionPreview as string | undefined);
      return formatToolResult({
        title: 'Project resumed',
        bullets: [
          { icon: '📁', label: 'Path', value: `\`${checked}\`` },
          { icon: '📖', label: 'Chapter', value: String(result.currentChapter) },
          { icon: '⏸', label: 'Per-run budget', value: `${result.chaptersPerRun} chapter(s)` },
          { icon: '⏭', label: 'Next step', value: `\`${next.currentStep}\`` },
          { icon: '📝', label: 'Expected', value: next.expectedFormat },
        ],
        sections: [
          { heading: 'Instruction', body: nextInstruction ?? '(see fullContextPath in raw)' },
        ],
        verbose,
        rawForVerbose: { state: result, next },
      });
    }
  );

  tool(
    'force_advance',
    'Force-exit a stuck chapter_review/chapter_revision gate. Sets the workflow to memory_card for the given chapter (default: the chapter currently in the gate), clears the revision counter, and records the chapter in forceAdvanced for audit. Use when the host cannot satisfy the review acceptance gate after several rounds.',
    {
      projectPath: z.string().min(1),
      chapterNumber: z.number().int().positive().optional(),
      reason: z.string().optional(),
    },
    async ({ projectPath, chapterNumber, reason }) =>
      textResult(await forceAdvanceChapter({ projectPath: checkedProjectPath(projectPath), chapterNumber, reason }))
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
      chapters: z.string().optional().describe('First-batch architecture size as a string. Defaults to 5. NOT the number of chapters to write this run — see chaptersPerRun.'),
      length: z.enum(['short', 'medium', 'long']).optional().describe('short=12 chapters, medium=100 chapters, long=open-ended. Ask the user if omitted.'),
      totalChapters: z.string().optional().describe('Explicit whole-book target chapter count. Overrides length when supplied.'),
      chaptersPerRun: z.string().optional().describe('How many chapters to write before pausing at complete. Default 1. Only override when the user explicitly says e.g. "write 5 chapters at once".'),
    },
    ({ prompt, chapters, length, totalChapters, chaptersPerRun }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: totalChapters || length
            ? `Use the novelforge MCP server. Call start_novel_project with prompt="${prompt}", targetChapters=${chapters ?? '5'}, chaptersPerRun=${chaptersPerRun ?? '1'}${totalChapters ? `, plannedTotalChapters=${totalChapters}` : `, lengthPreset="${length}"`}. Per-run default is 1 chapter — DO NOT raise chaptersPerRun unless the user explicitly asked for multiple chapters in one run (e.g. "一次写 5 章"). Then enter the autonomous loop: read the current instruction/context, generate the requested content, write long artifacts to a project-local file, call submit_step_result with contentPath for long chapter/review/memory/architecture payloads, then call get_next_step for the next full instruction/context. STOP the loop when currentStep is "complete" — tell the user the run paused after the budgeted chapter(s) and they can ask to continue (which will call continue_novel_project). Show me the projectPath after start_novel_project returns.`
            : `Before calling start_novel_project, ask me to choose novel length: short (~12 chapters), medium (~100 chapters), or long/open-ended. After I choose, call start_novel_project with prompt="${prompt}", targetChapters=${chapters ?? '5'}, chaptersPerRun=${chaptersPerRun ?? '1'}, and the matching lengthPreset. Per-run default is 1 chapter — DO NOT raise chaptersPerRun unless I explicitly asked for multiple chapters in one run. Do not silently default an unspecified novel to 12 chapters.`,
        },
      }],
    })
  );

  server.prompt(
    'nf-continue',
    'Resume a paused novelforge project for another batch of chapters.',
    {
      projectPath: z.string().describe('Absolute path to the project.'),
      chapters: z.string().optional().describe('How many chapters to write this run. Defaults to 1.'),
    },
    ({ projectPath, chapters }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the novelforge MCP server. Call continue_novel_project with projectPath="${projectPath}", chaptersPerRun=${chapters ?? '1'}. Then enter the autonomous loop: read each get_next_step instruction, generate the requested content (use contentPath for long artifacts), call submit_step_result, repeat. STOP the loop when currentStep is "complete" — the per-run budget has been spent; tell me the run paused and I can ask to continue again.`,
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
          text: `Use the novelforge MCP server. Call get_next_step with projectPath="${projectPath}". Read the returned instruction + context and produce the requested artifact. For long artifacts, write the artifact to a project-local file first and call submit_step_result with contentPath instead of inline content. The submit result is compact; call get_next_step again only if you need the next full instruction/context. Show me what step was advanced.`,
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
          text: `Use the novelforge MCP server: call review_chapter with projectPath="${projectPath}", chapterNumber=${chapterNumber}. Read the returned instruction + context, produce the JSON chapter review, write it to a project-local file, then call submit_step_result with step="chapter_review" and contentPath. The submit result is compact; call get_next_step only if you need the resumed full instruction/context. Summarize the findings for me.`,
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
          text: `Use the novelforge MCP server: call revise_chapter with projectPath="${projectPath}", chapterNumber=${chapterNumber}${feedback ? `, feedback=${JSON.stringify(feedback)}` : ''}. Read the returned instruction + context, produce the revised Markdown chapter, write it to a project-local file, then call submit_step_result with step="chapter_revision" and contentPath. The submit result is compact; call get_next_step only if you need the next full instruction/context. Confirm the previous version was archived.`,
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
          text: `Use the novelforge MCP server: call cross_chapter_review with projectPath="${projectPath}"${start && end ? `, start=${start}, end=${end}` : ''}. Read the returned instruction + context, produce the JSON cross-chapter review, write it to a project-local file, then call submit_step_result with step="cross_chapter_review" and contentPath. The submit result is compact; call get_next_step only if you need the resumed full instruction/context. Summarize verdict and any issues.`,
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
