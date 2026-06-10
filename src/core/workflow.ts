import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkflowStep, AgentState, ModelHint, PendingAction, PromptSegment, StepInstruction } from './types.js';
import { BuildContextInput, buildContext } from './contextBuilder.js';
import { buildPromptForStep } from './prompts.js';
import { loadState, saveJsonFile, saveRecoveryFile, saveState } from './projectStore.js';
import { STEP_HANDLERS } from './steps/index.js';
import { summarizeForLog, tryAppendAgentEvent } from './agentLog.js';

export interface SubmitStepInput {
  projectPath: string;
  step: WorkflowStep;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SubmitStepResult {
  validation: { ok: boolean; message: string };
  state: AgentState;
  savedPaths: string[];
  recoveryPath?: string;
  next?: StepInstruction;
}

export interface RequestSideTrackInput {
  projectPath: string;
  step: PendingAction['step'];
  chapterNumber?: number;
  range?: { start: number; end: number };
  feedback?: string;
}

// =============================================================================
// Context recipes — one entry per step that needs packed context.
// Steps not listed here run with an empty context string.
// =============================================================================

type ContextRecipe = (state: AgentState) => Omit<BuildContextInput, 'projectPath'>;

const CONTEXT_RECIPES: Partial<Record<WorkflowStep, ContextRecipe>> = {
  style_guide: () => ({ purpose: 'style_guide' }),
  architecture_extension: (s) => ({ purpose: 'architecture_extension', chapterNumber: s.currentChapter }),
  chapter: (s) => ({ purpose: 'chapter_generation', chapterNumber: s.currentChapter }),
  memory_card: (s) => ({ purpose: 'memory_extraction', chapterNumber: s.currentChapter }),
  continuity_review: () => ({ purpose: 'continuity_review' }),
  chapter_review: (s) => ({
    purpose: 'chapter_review',
    chapterNumber: s.pendingAction?.chapterNumber ?? s.currentChapter,
  }),
  chapter_revision: (s) => ({
    purpose: 'revision',
    chapterNumber: s.pendingAction?.chapterNumber ?? s.currentChapter,
    feedback: s.pendingAction?.feedback,
  }),
  cross_chapter_review: (s) => ({
    purpose: 'cross_chapter_review',
    range: s.pendingAction?.range,
  }),
};

async function contextForStep(state: AgentState): Promise<string> {
  const recipe = CONTEXT_RECIPES[state.currentStep];
  if (!recipe) return '';
  return buildContext({ projectPath: state.projectPath, ...recipe(state) });
}

// =============================================================================
// Per-step model-tier hint. Hosts may downgrade to cheaper models for
// 'cheap' / 'standard' steps; chapter generation and amendments should
// stay on the strongest available model.
// =============================================================================
const MODEL_HINT_BY_STEP: Record<WorkflowStep, ModelHint> = {
  novel_metadata: 'standard',
  story_bible: 'premium',
  style_guide: 'standard',
  architecture: 'premium',
  architecture_extension: 'premium',
  chapter: 'premium',
  memory_card: 'cheap',
  continuity_review: 'standard',
  chapter_review: 'standard',
  chapter_revision: 'premium',
  cross_chapter_review: 'standard',
  novel_metadata_amend: 'standard',
  story_bible_amend: 'standard',
  complete: 'cheap',
};

function buildSegments(promptText: string, context: string, providedSegments?: ReadonlyArray<PromptSegment>): PromptSegment[] {
  // If a builder supplied segments, trust them but ensure the context segment
  // (volatile per-call) is appended at the end.
  if (providedSegments && providedSegments.length > 0) {
    const segments: PromptSegment[] = providedSegments.map((s) => ({ ...s }));
    if (context && !segments.some((s) => s.id === 'context')) {
      segments.push({ id: 'context', text: `## Generation Context\n${context}`, cacheable: false, description: 'Per-call context (bible / threads / characters / retrieval).' });
    }
    return segments;
  }
  // Fallback: single non-cacheable segment from the full prompt text.
  return [{ id: 'prompt', text: promptText, cacheable: false, description: 'Full instruction text (cache-aware builders may split this).' }];
}

async function instructionFor(state: AgentState): Promise<StepInstruction> {
  const base = {
    projectId: state.projectId,
    projectPath: state.projectPath,
    currentStep: state.currentStep,
  };

  if (state.currentStep === 'complete') {
    const completeText = 'The workflow is complete.';
    return {
      ...base,
      instruction: completeText,
      expectedFormat: 'No output required',
      context: '',
      segments: [{ id: 'prompt', text: completeText, cacheable: true, description: 'Workflow complete marker.' }],
      modelHint: MODEL_HINT_BY_STEP.complete,
    };
  }

  const context = await contextForStep(state);
  const prompt = buildPromptForStep({ state, context });
  const segments = buildSegments(prompt.prompt, context, prompt.segments);
  return {
    ...base,
    instruction: prompt.prompt,
    expectedFormat: prompt.expectedFormat,
    context,
    segments,
    modelHint: MODEL_HINT_BY_STEP[state.currentStep],
  };
}

export async function getNextStep(projectPath: string): Promise<StepInstruction> {
  return instructionFor(await loadState(projectPath));
}

// =============================================================================
// Side-track plumbing
// =============================================================================

interface SideTrackEntry {
  step: PendingAction['step'];
  resumeStep: WorkflowStep;
  resumeChapter: number;
  pendingAction: PendingAction;
}

const SIDE_TRACK_FILE = '.agent-recovery/side-track.json';

async function saveSideTrack(state: AgentState, entry: SideTrackEntry): Promise<void> {
  await saveState(state);
  await saveJsonFile(state.projectPath, SIDE_TRACK_FILE, entry);
}

async function loadSideTrack(projectPath: string): Promise<SideTrackEntry | undefined> {
  try {
    const raw = await readFile(join(projectPath, SIDE_TRACK_FILE), 'utf8');
    return JSON.parse(raw) as SideTrackEntry;
  } catch {
    return undefined;
  }
}

async function clearSideTrack(projectPath: string): Promise<void> {
  try {
    await unlink(join(projectPath, SIDE_TRACK_FILE));
  } catch {
    // ignore: nothing to clear
  }
}

function maxExistingChapter(state: AgentState): number {
  let max = 0;
  for (const key of Object.keys(state.files)) {
    const match = key.match(/^chapter-(\d+)$/);
    if (match) {
      const num = Number(match[1]);
      if (num > max) max = num;
    }
  }
  return max;
}

function buildPendingAction(state: AgentState, input: RequestSideTrackInput): PendingAction {
  switch (input.step) {
    case 'chapter_review': {
      if (!input.chapterNumber) throw new Error('chapter_review requires chapterNumber');
      return { step: 'chapter_review', mode: 'side_track', chapterNumber: input.chapterNumber };
    }
    case 'chapter_revision': {
      if (!input.chapterNumber) throw new Error('chapter_revision requires chapterNumber');
      return { step: 'chapter_revision', mode: 'side_track', chapterNumber: input.chapterNumber, feedback: input.feedback };
    }
    case 'cross_chapter_review': {
      const max = maxExistingChapter(state);
      const range = input.range ?? { start: 1, end: max || state.currentChapter };
      if (range.start < 1 || range.end < range.start) throw new Error('Invalid range');
      return { step: 'cross_chapter_review', mode: 'side_track', range };
    }
    default:
      throw new Error(`Unknown side-track step: ${(input as RequestSideTrackInput).step}`);
  }
}

export async function requestSideTrack(input: RequestSideTrackInput): Promise<StepInstruction> {
  const state = await loadState(input.projectPath);
  const pendingAction = buildPendingAction(state, input);
  const next: AgentState = { ...state, currentStep: input.step, pendingAction };
  await saveSideTrack(next, {
    step: input.step,
    resumeStep: state.currentStep,
    resumeChapter: state.currentChapter,
    pendingAction,
  });
  return instructionFor(next);
}

// =============================================================================
// Submit dispatcher — thin glue over STEP_HANDLERS
// =============================================================================

function advanceLinear(
  state: AgentState,
  nextStep: WorkflowStep,
  fileEntries: Record<string, string> = {},
  statePatch: Partial<AgentState> = {}
): AgentState {
  const { pendingAction: _pending, ...rest } = state;
  return {
    ...rest,
    ...statePatch,
    currentStep: nextStep,
    completedSteps: [...state.completedSteps, state.currentStep],
    files: { ...state.files, ...fileEntries },
  };
}

async function resumeFromSideTrack(
  state: AgentState,
  fileEntries: Record<string, string>
): Promise<AgentState> {
  const sideTrack = await loadSideTrack(state.projectPath);
  await clearSideTrack(state.projectPath);
  return {
    ...state,
    currentStep: sideTrack?.resumeStep ?? state.currentStep,
    currentChapter: sideTrack?.resumeChapter ?? state.currentChapter,
    completedSteps: [...state.completedSteps, state.currentStep],
    files: { ...state.files, ...fileEntries },
    pendingAction: undefined,
  };
}

export async function submitStepResult(input: SubmitStepInput): Promise<SubmitStepResult> {
  const state = await loadState(input.projectPath);

  if (state.currentStep !== input.step) {
    const recoveryPath = await saveRecoveryFile(state.projectPath, input.step, input.content);
    await tryAppendAgentEvent(state.projectPath, {
      type: 'submission_rejected',
      level: 'warn',
      inputSummary: summarizeForLog({ step: input.step, content: input.content }),
      recoveryPath,
      message: `Expected step ${state.currentStep}, got ${input.step}`,
    });
    return {
      validation: { ok: false, message: `Expected step ${state.currentStep}, got ${input.step}` },
      state,
      savedPaths: [],
      recoveryPath,
      next: await instructionFor(state),
    };
  }

  const handler = STEP_HANDLERS[input.step];
  if (!handler) {
    await tryAppendAgentEvent(state.projectPath, {
      type: 'submission_rejected',
      level: 'warn',
      inputSummary: summarizeForLog({ step: input.step, content: input.content }),
      message: `Step ${input.step} accepts no submission`,
    });
    return {
      validation: { ok: false, message: `Step ${input.step} accepts no submission` },
      state,
      savedPaths: [],
      next: await instructionFor(state),
    };
  }

  try {
    const result = await handler(state, input.content);
    const fileEntries = result.fileEntries ?? {};
    const nextState =
      result.next.kind === 'linear'
        ? advanceLinear(state, result.next.nextStep, fileEntries, result.next.statePatch)
        : await resumeFromSideTrack(state, fileEntries);

    await saveState(nextState);
    await tryAppendAgentEvent(nextState.projectPath, {
      type: 'state_transition',
      stateTransition: {
        from: {
          currentStep: state.currentStep,
          currentChapter: state.currentChapter,
          projectPath: state.projectPath,
        },
        to: {
          currentStep: nextState.currentStep,
          currentChapter: nextState.currentChapter,
          projectPath: nextState.projectPath,
        },
      },
      savedPaths: result.savedPaths,
    });
    return {
      validation: { ok: true, message: 'Saved' },
      state: nextState,
      savedPaths: result.savedPaths,
      next: await instructionFor(nextState),
    };
  } catch (error) {
    const recoveryPath = await saveRecoveryFile(state.projectPath, input.step, input.content);
    await tryAppendAgentEvent(state.projectPath, {
      type: 'submission_error',
      level: 'error',
      inputSummary: summarizeForLog({ step: input.step, content: input.content }),
      recoveryPath,
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
      },
    });
    return {
      validation: { ok: false, message: (error as Error).message },
      state,
      savedPaths: [],
      recoveryPath,
      next: await instructionFor(state),
    };
  }
}
