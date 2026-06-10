import { randomBytes, randomUUID } from 'node:crypto';
import { cp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
// guards
// =============================================================================

export function assertProjectPath(workspaceRoot: string, projectPath: string): void {
  const root = resolve(workspaceRoot);
  const target = resolve(projectPath);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to operate outside workspace: ${target}`);
  }
}

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
