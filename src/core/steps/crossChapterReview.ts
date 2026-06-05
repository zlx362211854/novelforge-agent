import { join } from 'node:path';
import { CrossChapterReviewSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { crossChapterReviewFileName } from '../fileNames.js';
import { StepHandler, parseJson } from './types.js';

export const crossChapterReviewHandler: StepHandler = async (state, content) => {
  const parsed = CrossChapterReviewSchema.parse(parseJson(content));
  const relative = join('reviews/cross', crossChapterReviewFileName(parsed.range.start, parsed.range.end));
  const path = await saveJsonFile(state.projectPath, relative, parsed);
  return {
    savedPaths: [path],
    fileEntries: { [`review-cross-${parsed.range.start}-${parsed.range.end}`]: relative },
    next: { kind: 'sideTrackReturn' },
  };
};
