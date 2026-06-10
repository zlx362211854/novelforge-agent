import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MemoryCardSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { memoryFileName } from '../fileNames.js';
import { indexMemoryCard } from '../retrieval/index.js';
import { ingestMemoryCardThreads } from '../threadStore.js';
import { applyCharacterUpdates } from '../characterStore.js';
import { StepHandler, parseJson } from './types.js';

async function maxPlannedChapter(projectPath: string): Promise<number> {
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

export const memoryCardHandler: StepHandler = async (state, content) => {
  const parsed = MemoryCardSchema.parse(parseJson(content));
  const relative = join('memory', memoryFileName(state.currentChapter));
  const path = await saveJsonFile(state.projectPath, relative, parsed);
  await indexMemoryCard(state.projectPath, state.currentChapter, parsed);
  await ingestMemoryCardThreads(state.projectPath, state.currentChapter, parsed.threadActions);
  await applyCharacterUpdates(state.projectPath, state.currentChapter, parsed.characterUpdates);
  const nextChapter = state.currentChapter + 1;
  const plannedTotalChapters = state.plannedTotalChapters ?? state.targetChapters;
  const plannedMax = await maxPlannedChapter(state.projectPath);
  const runStart = state.runStartChapter ?? 1;
  const perRunCap = state.chaptersPerRun;
  const chaptersWrittenThisRun = nextChapter - runStart;
  const runBudgetExhausted =
    typeof perRunCap === 'number' && perRunCap > 0 && chaptersWrittenThisRun >= perRunCap;
  const nextStep =
    runBudgetExhausted && nextChapter <= plannedTotalChapters
      ? 'complete'
      : nextChapter > plannedTotalChapters
        ? 'continuity_review'
        : nextChapter > plannedMax
          ? 'architecture_extension'
          : 'chapter';
  return {
    savedPaths: [path],
    fileEntries: { [`memory-${state.currentChapter}`]: relative },
    next: {
      kind: 'linear',
      nextStep,
      statePatch: { currentChapter: nextChapter },
    },
  };
};
