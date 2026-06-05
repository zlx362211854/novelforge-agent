import { join } from 'node:path';
import { ChapterReviewSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { chapterReviewFileName } from '../fileNames.js';
import { StepHandler, parseJson } from './types.js';

export const chapterReviewHandler: StepHandler = async (state, content) => {
  const parsed = ChapterReviewSchema.parse(parseJson(content));
  const target = state.pendingAction?.chapterNumber ?? parsed.chapterNumber;
  const relative = join('reviews/chapter', chapterReviewFileName(target));
  const path = await saveJsonFile(state.projectPath, relative, parsed);
  return {
    savedPaths: [path],
    fileEntries: { [`review-chapter-${target}`]: relative },
    next: { kind: 'sideTrackReturn' },
  };
};
