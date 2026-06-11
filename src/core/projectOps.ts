import { randomBytes, randomUUID } from 'node:crypto';
import { cp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir, platform as osPlatform } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep as defaultSep } from 'node:path';
import * as pathPosix from 'node:path/posix';
import * as pathWin32 from 'node:path/win32';
import { AgentState, WorkflowStep } from './types.js';
import { loadState, saveState } from './projectStore.js';
import { indexChapter, removeChapterFromIndex, removeMemoryCardFromIndex } from './retrieval/index.js';
import { chapterFileName, memoryFileName } from './fileNames.js';

// =============================================================================
// fork_project
// =============================================================================

export interface ForkProjectInput {
  sourceProjectPath: string;
  label?: string;
}

export interface ForkProjectResult {
  newProjectPath: string;
  newProjectId: string;
}

export async function forkProject(input: ForkProjectInput): Promise<ForkProjectResult> {
  const source = resolve(input.sourceProjectPath);
  const state = await loadState(source);
  const suffix = randomBytes(3).toString('hex');
  const label = (input.label ?? 'fork').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'fork';
  const targetName = `${basename(source)}-${label}-${suffix}`;
  const target = join(dirname(source), targetName);

  await cp(source, target, { recursive: true });

  const forkedState: AgentState = {
    ...state,
    projectId: randomUUID(),
    projectPath: target,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveState(forkedState);
  return { newProjectPath: target, newProjectId: forkedState.projectId };
}

// =============================================================================
// delete_chapter
// =============================================================================

export interface DeleteChapterInput {
  projectPath: string;
  chapterNumber: number;
}

export interface DeleteChapterResult {
  removed: string[];
  newCurrentChapter: number;
  newCurrentStep: WorkflowStep;
}

async function tryUnlink(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

async function tryRmDirEntry(dirPath: string, prefix: string): Promise<string[]> {
  const removed: string[] = [];
  try {
    const items = await readdir(dirPath);
    for (const item of items) {
      if (item.startsWith(prefix)) {
        const full = join(dirPath, item);
        try {
          await unlink(full);
          removed.push(full);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // dir absent
  }
  return removed;
}

export async function deleteChapter(input: DeleteChapterInput): Promise<DeleteChapterResult> {
  const state = await loadState(input.projectPath);
  const n = input.chapterNumber;
  if (n < 1) throw new Error('chapterNumber must be >= 1');

  const removed: string[] = [];
  const chapterRel = join('chapters', chapterFileName(n));
  if (await tryUnlink(join(state.projectPath, chapterRel))) removed.push(chapterRel);

  const memoryRel = join('memory', memoryFileName(n));
  if (await tryUnlink(join(state.projectPath, memoryRel))) removed.push(memoryRel);

  // Versions of this chapter
  const versionsRemoved = await tryRmDirEntry(
    join(state.projectPath, 'chapters/.versions'),
    `${chapterFileName(n).replace(/\.md$/, '')}.`
  );
  removed.push(...versionsRemoved);

  // Per-chapter review
  const reviewName = `chapter-${String(n).padStart(3, '0')}.json`;
  if (await tryUnlink(join(state.projectPath, 'reviews/chapter', reviewName))) {
    removed.push(`reviews/chapter/${reviewName}`);
  }

  // Update state.files
  const nextFiles: Record<string, string> = { ...state.files };
  delete nextFiles[`chapter-${n}`];
  delete nextFiles[`memory-${n}`];
  delete nextFiles[`review-chapter-${n}`];

  // Remove this chapter and its memory card from the lexical index
  await removeChapterFromIndex(state.projectPath, n);
  await removeMemoryCardFromIndex(state.projectPath, n);

  // Adjust state.currentChapter & currentStep if needed
  let newCurrentChapter = state.currentChapter;
  let newCurrentStep: WorkflowStep = state.currentStep;
  if (state.currentChapter > n) {
    // user deleted an earlier chapter; current pointer becomes the deleted one to be regenerated
    newCurrentChapter = n;
    newCurrentStep = 'chapter';
  } else if (state.currentChapter === n + 1 && (state.currentStep === 'chapter' || state.currentStep === 'memory_card')) {
    // we just finished chapter n and were about to do n+1; step back
    newCurrentChapter = n;
    newCurrentStep = 'chapter';
  }

  const nextState: AgentState = {
    ...state,
    files: nextFiles,
    currentChapter: newCurrentChapter,
    currentStep: newCurrentStep,
    pendingAction: undefined,
  };
  await saveState(nextState);
  return { removed, newCurrentChapter, newCurrentStep };
}

// =============================================================================
// redo_step
// =============================================================================

export interface RedoStepInput {
  projectPath: string;
  step: WorkflowStep;
  chapterNumber?: number;
}

export interface RedoStepResult {
  removed: string[];
  currentStep: WorkflowStep;
  currentChapter: number;
}

const STEP_FILE_KEYS: Partial<Record<WorkflowStep, string[]>> = {
  novel_metadata: ['novel'],
  story_bible: ['storyBible'],
  style_guide: ['styleGuide'],
  architecture: ['architecture'],
  continuity_review: ['continuityReview'],
};

const STEP_FILE_PATHS: Partial<Record<WorkflowStep, string[]>> = {
  novel_metadata: ['novel.json'],
  story_bible: ['story-bible.md'],
  style_guide: ['style-guide.json'],
  architecture: ['architecture/full.md', 'architecture/volumes.json', 'architecture/chapters.json'],
};

export async function redoStep(input: RedoStepInput): Promise<RedoStepResult> {
  const state = await loadState(input.projectPath);
  const removed: string[] = [];

  if (input.step === 'chapter' || input.step === 'memory_card') {
    const chapter = input.chapterNumber ?? state.currentChapter;
    if (input.step === 'memory_card') {
      const rel = join('memory', memoryFileName(chapter));
      if (await tryUnlink(join(state.projectPath, rel))) removed.push(rel);
      delete state.files[`memory-${chapter}`];
    } else {
      // chapter: also remove its memory + per-chapter review since they depend on it
      const cRel = join('chapters', chapterFileName(chapter));
      if (await tryUnlink(join(state.projectPath, cRel))) removed.push(cRel);
      const mRel = join('memory', memoryFileName(chapter));
      if (await tryUnlink(join(state.projectPath, mRel))) removed.push(mRel);
      delete state.files[`chapter-${chapter}`];
      delete state.files[`memory-${chapter}`];
      await removeChapterFromIndex(state.projectPath, chapter);
      await removeMemoryCardFromIndex(state.projectPath, chapter);
    }
    state.currentChapter = chapter;
    state.currentStep = input.step;
    state.pendingAction = undefined;
  } else if (
    input.step === 'novel_metadata'
    || input.step === 'story_bible'
    || input.step === 'style_guide'
    || input.step === 'architecture'
    || input.step === 'continuity_review'
  ) {
    const paths = STEP_FILE_PATHS[input.step] ?? [];
    for (const p of paths) {
      if (await tryUnlink(join(state.projectPath, p))) removed.push(p);
    }
    const keys = STEP_FILE_KEYS[input.step] ?? [];
    for (const k of keys) {
      delete state.files[k];
    }
    state.currentStep = input.step;
    state.pendingAction = undefined;
    if (input.step === 'novel_metadata') state.currentChapter = 1;
  } else {
    throw new Error(`redo_step does not support step: ${input.step}`);
  }

  // Trim completedSteps after the redo target
  const idx = state.completedSteps.lastIndexOf(input.step);
  if (idx >= 0) state.completedSteps = state.completedSteps.slice(0, idx);

  await saveState(state);
  return {
    removed,
    currentStep: state.currentStep,
    currentChapter: state.currentChapter,
  };
}

// =============================================================================
// force_advance
// =============================================================================

export interface ForceAdvanceInput {
  projectPath: string;
  chapterNumber?: number;
  reason?: string;
}

export interface ForceAdvanceResult {
  currentStep: WorkflowStep;
  currentChapter: number;
  forceAdvanced: number[];
}

/**
 * Manually exit the chapter_review / chapter_revision gate for a stuck chapter.
 * Moves the workflow to memory_card, clears any pending action, drops the
 * revision counter, and records the chapter as force-advanced for later audit.
 */
export async function forceAdvanceChapter(input: ForceAdvanceInput): Promise<ForceAdvanceResult> {
  const state = await loadState(input.projectPath);
  const target = input.chapterNumber ?? state.pendingAction?.chapterNumber ?? state.currentChapter;
  const cleanedCounts = { ...(state.revisionCounts ?? {}) };
  delete cleanedCounts[target];
  const nextForceAdvanced = Array.from(new Set([...(state.forceAdvanced ?? []), target]));
  const next: AgentState = {
    ...state,
    currentStep: 'memory_card',
    currentChapter: target,
    pendingAction: undefined,
    revisionCounts: cleanedCounts,
    forceAdvanced: nextForceAdvanced,
  };
  await saveState(next);
  return {
    currentStep: next.currentStep,
    currentChapter: next.currentChapter,
    forceAdvanced: nextForceAdvanced,
  };
}

// =============================================================================
// Path safety policy
//
// The threat model NovelForge actually faces is "user runs the MCP server on
// their own machine, points it at their own host (Claude Code / Codex /
// WorkBuddy / …), wants to write novels somewhere on their disk." The hosts
// are user-trusted; the user is the one issuing tool calls.
//
// In that model the security cost of "must be inside NOVELFORGE_WORKSPACE" is
// huge — every host that has its own session directory gets blocked. The
// security benefit is small — the same user could just run `rm -rf` directly.
//
// So we flip the default:
//   - DEFAULT (permissive): allow any path that isn't a known system path.
//     System paths (POSIX /etc, /usr, /bin, /sbin, /var, /opt, /System,
//     /Library, …; Windows %SystemRoot%, %ProgramFiles%, %ProgramData%) are
//     always blocked unconditionally.
//   - STRICT (opt-in via NOVELFORGE_STRICT_WORKSPACE=1): the legacy
//     workspace-bound behavior, for multi-tenant servers / paranoid users.
//     Requires NOVELFORGE_WORKSPACE to be set; rejects anything outside it.
// =============================================================================

export interface PathSafetyPolicy {
  /** Effective platform; defaults to current process platform. */
  platform?: NodeJS.Platform;
  /** Effective user home; defaults to os.homedir(). */
  home?: string;
  /** Workspace root if explicitly configured. */
  workspaceRoot?: string;
  /** Force strict mode; defaults to NOVELFORGE_STRICT_WORKSPACE=1. */
  strict?: boolean;
  /** Override system paths (for testing). */
  systemPaths?: string[];
  /** Override env (for testing). */
  env?: NodeJS.ProcessEnv;
}

export interface PathSafetyResult {
  ok: boolean;
  reason?: string;
}

// Note: we intentionally DO NOT block /var, /tmp, /opt or /private/var.
// macOS resolves os.tmpdir() to /var/folders/... (== /private/var/folders/...),
// which is a legitimate user-owned location. Linux apps use /var/log,
// /var/lib, /opt for legitimate user-controlled data. Blocking these would
// reject hosts that already write their session data there.
const POSIX_SYSTEM_PATHS = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/root',
  '/System',
  '/Library',
  '/Applications',
  '/private/etc',
  '/private/sbin',
  '/private/usr',
];

function getWindowsSystemPaths(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const candidates = [
    env.SystemRoot,
    env.windir,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramW6432,
    env.ProgramData,
    env.PUBLIC,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) out.push(c);
  }
  // Hard-coded fallbacks in case env vars aren't set.
  out.push('C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData');
  return Array.from(new Set(out));
}

function getSystemPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') return getWindowsSystemPaths(env);
  return POSIX_SYSTEM_PATHS.slice();
}

function resolvePlatform(p: string, platform: NodeJS.Platform): string {
  // path.resolve uses the host platform's path semantics — but we want to be
  // able to reason about Windows paths even when running on POSIX (and vice
  // versa) so tests can verify Windows behavior on a Mac/Linux dev machine.
  return platform === 'win32' ? pathWin32.resolve(p) : pathPosix.resolve(p);
}

function normalizeForCompare(p: string, platform: NodeJS.Platform): string {
  // On Windows, path comparison is case-insensitive AND separator-insensitive.
  if (platform === 'win32') {
    return p.replace(/\\/g, '/').toLowerCase();
  }
  return p;
}

function pathStartsWith(child: string, parent: string, platform: NodeJS.Platform): boolean {
  const c = normalizeForCompare(child, platform);
  const p = normalizeForCompare(parent, platform);
  if (c === p) return true;
  // After normalizeForCompare, separators are POSIX-style ('/').
  const sep = '/';
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Pure deterministic path check — does not consult process state directly so
 * tests can simulate Windows / different homes / different envs.
 */
export function checkPathSafety(requestedPath: string, policy: PathSafetyPolicy = {}): PathSafetyResult {
  const platform = policy.platform ?? osPlatform();
  const home = policy.home ?? homedir();
  const env = policy.env ?? process.env;
  const strict = policy.strict ?? env.NOVELFORGE_STRICT_WORKSPACE === '1';
  const systemPaths = policy.systemPaths ?? getSystemPaths(platform, env);

  // Resolve using the policy's platform semantics so tests can simulate
  // Windows paths on POSIX dev machines and vice-versa.
  const resolved = resolvePlatform(requestedPath, platform);

  // 1. System paths are always blocked, regardless of strict / permissive.
  //    But /Library is fine if it's actually ~/Library (inside home).
  const insideHome = pathStartsWith(resolved, home, platform);
  for (const sp of systemPaths) {
    if (pathStartsWith(resolved, sp, platform)) {
      // Allow ~/Library/Application Support/... (inside home) even though /Library is a blocked prefix.
      if (insideHome) continue;
      return {
        ok: false,
        reason: `Refusing to write to a system directory: ${resolved}\nMatched blocked prefix: ${sp}\nNovelForge always refuses system paths regardless of NOVELFORGE_WORKSPACE.`,
      };
    }
  }

  // 2. Strict mode: must be inside NOVELFORGE_WORKSPACE.
  if (strict) {
    if (!policy.workspaceRoot) {
      return {
        ok: false,
        reason: 'NOVELFORGE_STRICT_WORKSPACE=1 requires NOVELFORGE_WORKSPACE to be set, but it was not provided.',
      };
    }
    const root = resolvePlatform(policy.workspaceRoot, platform);
    if (!pathStartsWith(resolved, root, platform)) {
      return {
        ok: false,
        reason: `Strict mode: ${resolved} is outside NOVELFORGE_WORKSPACE (${root}).\nEither move the project inside the workspace, unset NOVELFORGE_STRICT_WORKSPACE, or restart with a different NOVELFORGE_WORKSPACE.`,
      };
    }
    return { ok: true };
  }

  // 3. Default permissive: allow.
  return { ok: true };
}

// =============================================================================
// guards (back-compat wrapper)
// =============================================================================

export function assertProjectPath(workspaceRoot: string | undefined, projectPath: string): void {
  const result = checkPathSafety(projectPath, { workspaceRoot });
  if (!result.ok) {
    throw new Error(`❌ NovelForge path rejected.\n\n${result.reason}\n\nFix:\n  • Make sure the path is inside your user home, or\n  • Set NOVELFORGE_WORKSPACE=<dir> at MCP server startup and restart the host, or\n  • Unset NOVELFORGE_STRICT_WORKSPACE to use the permissive default.`);
  }
}

// keep `defaultSep` referenced — it's used implicitly by path.resolve.
void defaultSep;

// keep tsc happy if no other refs
void writeFile;

// =============================================================================
// continue_novel_project
// =============================================================================

export interface ContinueProjectInput {
  projectPath: string;
  chaptersPerRun?: number;
}

export interface ContinueProjectResult {
  currentStep: WorkflowStep;
  currentChapter: number;
  chaptersPerRun: number;
  runStartChapter: number;
  alreadyAtEnd: boolean;
}

async function maxPlannedChapterFromFile(projectPath: string): Promise<number> {
  try {
    const raw = await readFile(join(projectPath, 'architecture/chapters.json'), 'utf8');
    const chapters = JSON.parse(raw) as Array<{ chapterNumber?: number }>;
    return chapters.reduce((max, chapter) => {
      const value = Number(chapter.chapterNumber);
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);
  } catch {
    return 0;
  }
}

/**
 * Resume a project whose previous run paused at `complete` because the
 * per-run chapter budget was exhausted. Recomputes the proper next step
 * (chapter / architecture_extension / continuity_review) from the current
 * chapter number and architecture plan, and resets the run budget.
 *
 * If the project is genuinely finished (currentChapter > plannedTotalChapters),
 * leaves the state untouched and returns alreadyAtEnd=true.
 */
export async function continueProject(input: ContinueProjectInput): Promise<ContinueProjectResult> {
  const state = await loadState(input.projectPath);
  const plannedTotalChapters = state.plannedTotalChapters ?? state.targetChapters;
  if (state.currentChapter > plannedTotalChapters) {
    return {
      currentStep: state.currentStep,
      currentChapter: state.currentChapter,
      chaptersPerRun: state.chaptersPerRun ?? 1,
      runStartChapter: state.runStartChapter ?? state.currentChapter,
      alreadyAtEnd: true,
    };
  }

  const requestedBudget = Math.max(1, Math.floor(Number(input.chaptersPerRun ?? 1)));
  const plannedMax = await maxPlannedChapterFromFile(state.projectPath);
  const nextStep: WorkflowStep =
    state.currentChapter > plannedMax ? 'architecture_extension' : 'chapter';

  const next: AgentState = {
    ...state,
    currentStep: nextStep,
    chaptersPerRun: requestedBudget,
    runStartChapter: state.currentChapter,
    pendingAction: undefined,
  };
  await saveState(next);
  return {
    currentStep: next.currentStep,
    currentChapter: next.currentChapter,
    chaptersPerRun: requestedBudget,
    runStartChapter: state.currentChapter,
    alreadyAtEnd: false,
  };
}
