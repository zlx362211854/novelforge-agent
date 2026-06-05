import { join } from 'node:path';
import {
  ArchitecturePayloadSchema,
  ContinuityReviewSchema,
  MemoryCardSchema,
  NovelMetadataSchema,
} from './schemas.js';
import { WorkflowStep, AgentState, StepInstruction } from './types.js';
import {
  loadState,
  saveJsonFile,
  saveMarkdownFile,
  saveRecoveryFile,
  saveState,
} from './projectStore.js';
import { chapterFileName, memoryFileName } from './fileNames.js';

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

function instructionFor(state: AgentState): StepInstruction {
  const base = {
    projectId: state.projectId,
    projectPath: state.projectPath,
    currentStep: state.currentStep,
  };

  if (state.currentStep === 'novel_metadata') {
    return {
      ...base,
      instruction: 'Generate novel metadata as JSON with title, genre, premise, language, style, and coreCast.',
      expectedFormat: 'JSON matching NovelMetadataSchema',
      context: `Initial prompt:\n${state.initialPrompt}`,
    };
  }

  if (state.currentStep === 'story_bible') {
    return {
      ...base,
      instruction: 'Generate a Markdown story bible covering characters, world rules, tone, conflicts, and long-running threads.',
      expectedFormat: 'Markdown',
      context: `Initial prompt:\n${state.initialPrompt}`,
    };
  }

  if (state.currentStep === 'architecture') {
    return {
      ...base,
      instruction: `Generate full-book, volume, and at least ${state.targetChapters} chapter architectures as JSON.`,
      expectedFormat: 'JSON matching ArchitecturePayloadSchema',
      context: `Target first-run chapters: ${state.targetChapters}`,
    };
  }

  if (state.currentStep === 'chapter') {
    return {
      ...base,
      instruction: `Generate chapter ${state.currentChapter} as Markdown with a title heading and prose body.`,
      expectedFormat: 'Markdown',
      context: `Current chapter: ${state.currentChapter}`,
    };
  }

  if (state.currentStep === 'memory_card') {
    return {
      ...base,
      instruction: `Extract a memory card for chapter ${state.currentChapter} as JSON.`,
      expectedFormat: 'JSON matching MemoryCardSchema',
      context: `Current chapter: ${state.currentChapter}`,
    };
  }

  if (state.currentStep === 'continuity_review') {
    return {
      ...base,
      instruction: `Review continuity for chapters 1-${state.targetChapters} as JSON.`,
      expectedFormat: 'JSON matching ContinuityReviewSchema',
      context: `Chapter range: 1-${state.targetChapters}`,
    };
  }

  return {
    ...base,
    instruction: 'The workflow is complete.',
    expectedFormat: 'No output required',
    context: '',
  };
}

export async function getNextStep(projectPath: string): Promise<StepInstruction> {
  return instructionFor(await loadState(projectPath));
}

function parseJson(content: string): unknown {
  return JSON.parse(content);
}

function advanceState(state: AgentState, nextStep: WorkflowStep): AgentState {
  return {
    ...state,
    currentStep: nextStep,
    completedSteps: [...state.completedSteps, state.currentStep],
  };
}

export async function submitStepResult(input: SubmitStepInput): Promise<SubmitStepResult> {
  const state = await loadState(input.projectPath);
  if (state.currentStep !== input.step) {
    const recoveryPath = await saveRecoveryFile(state.projectPath, input.step, input.content);
    return {
      validation: { ok: false, message: `Expected step ${state.currentStep}, got ${input.step}` },
      state,
      savedPaths: [],
      recoveryPath,
      next: instructionFor(state),
    };
  }

  try {
    const savedPaths: string[] = [];
    let nextState = state;

    if (input.step === 'novel_metadata') {
      const parsed = NovelMetadataSchema.parse(parseJson(input.content));
      savedPaths.push(await saveJsonFile(state.projectPath, 'novel.json', parsed));
      nextState = advanceState({ ...state, files: { ...state.files, novel: 'novel.json' } }, 'story_bible');
    } else if (input.step === 'story_bible') {
      if (!input.content.trim()) throw new Error('Story bible Markdown is empty');
      savedPaths.push(await saveMarkdownFile(state.projectPath, 'story-bible.md', input.content));
      nextState = advanceState({ ...state, files: { ...state.files, storyBible: 'story-bible.md' } }, 'architecture');
    } else if (input.step === 'architecture') {
      const parsed = ArchitecturePayloadSchema.parse(parseJson(input.content));
      savedPaths.push(await saveMarkdownFile(state.projectPath, 'architecture/full.md', parsed.full));
      savedPaths.push(await saveJsonFile(state.projectPath, 'architecture/volumes.json', parsed.volumes));
      savedPaths.push(await saveJsonFile(state.projectPath, 'architecture/chapters.json', parsed.chapters));
      nextState = advanceState({ ...state, files: { ...state.files, architecture: 'architecture/chapters.json' } }, 'chapter');
    } else if (input.step === 'chapter') {
      if (!input.content.trim()) throw new Error('Chapter Markdown is empty');
      const relative = join('chapters', chapterFileName(state.currentChapter));
      savedPaths.push(await saveMarkdownFile(state.projectPath, relative, input.content));
      nextState = advanceState({ ...state, files: { ...state.files, [`chapter-${state.currentChapter}`]: relative } }, 'memory_card');
    } else if (input.step === 'memory_card') {
      const parsed = MemoryCardSchema.parse(parseJson(input.content));
      const relative = join('memory', memoryFileName(state.currentChapter));
      savedPaths.push(await saveJsonFile(state.projectPath, relative, parsed));
      const nextChapter = state.currentChapter + 1;
      nextState = advanceState(
        { ...state, currentChapter: nextChapter, files: { ...state.files, [`memory-${state.currentChapter}`]: relative } },
        nextChapter > state.targetChapters ? 'continuity_review' : 'chapter'
      );
    } else if (input.step === 'continuity_review') {
      const parsed = ContinuityReviewSchema.parse(parseJson(input.content));
      const relative = `reviews/continuity-${parsed.range.start}-${parsed.range.end}.json`;
      savedPaths.push(await saveJsonFile(state.projectPath, relative, parsed));
      nextState = advanceState({ ...state, files: { ...state.files, continuityReview: relative } }, 'complete');
    }

    await saveState(nextState);
    return {
      validation: { ok: true, message: 'Saved' },
      state: nextState,
      savedPaths,
      next: instructionFor(nextState),
    };
  } catch (error) {
    const recoveryPath = await saveRecoveryFile(state.projectPath, input.step, input.content);
    return {
      validation: { ok: false, message: (error as Error).message },
      state,
      savedPaths: [],
      recoveryPath,
      next: instructionFor(state),
    };
  }
}
