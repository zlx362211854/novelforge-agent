import { join } from 'node:path';
import { ChapterReviewSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { chapterReviewFileName } from '../fileNames.js';
import { StepHandler, parseJson } from './types.js';

export const chapterReviewHandler: StepHandler = async (state, content) => {
  const parsed = ChapterReviewSchema.parse(parseJson(content));
  const hasFailedAcceptance = Object.values(parsed.acceptance).some((check) => check.status === 'fail');
  const target = state.pendingAction?.chapterNumber ?? parsed.chapterNumber;
  const relative = join('reviews/chapter', chapterReviewFileName(target));
  const path = await saveJsonFile(state.projectPath, relative, parsed);
  if (state.pendingAction?.mode === 'side_track') {
    return {
      savedPaths: [path],
      fileEntries: { [`review-chapter-${target}`]: relative },
      next: { kind: 'sideTrackReturn' },
    };
  }

  if (parsed.status === 'clean' && !hasFailedAcceptance) {
    return {
      savedPaths: [path],
      fileEntries: { [`review-chapter-${target}`]: relative },
      next: { kind: 'linear', nextStep: 'memory_card' },
    };
  }

  return {
    savedPaths: [path],
    fileEntries: { [`review-chapter-${target}`]: relative },
    next: {
      kind: 'linear',
      nextStep: 'chapter_revision',
      statePatch: {
        pendingAction: {
          step: 'chapter_revision',
          mode: 'gate',
          chapterNumber: target,
        },
      },
    },
  };
};
