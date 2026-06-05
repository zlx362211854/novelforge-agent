import { join } from 'node:path';
import { MemoryCardSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { memoryFileName } from '../fileNames.js';
import { indexMemoryCard } from '../retrieval/index.js';
import { StepHandler, parseJson } from './types.js';

export const memoryCardHandler: StepHandler = async (state, content) => {
  const parsed = MemoryCardSchema.parse(parseJson(content));
  const relative = join('memory', memoryFileName(state.currentChapter));
  const path = await saveJsonFile(state.projectPath, relative, parsed);
  await indexMemoryCard(state.projectPath, state.currentChapter, parsed);
  const nextChapter = state.currentChapter + 1;
  return {
    savedPaths: [path],
    fileEntries: { [`memory-${state.currentChapter}`]: relative },
    next: {
      kind: 'linear',
      nextStep: nextChapter > state.targetChapters ? 'continuity_review' : 'chapter',
      statePatch: { currentChapter: nextChapter },
    },
  };
};
