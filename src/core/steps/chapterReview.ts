import { join } from 'node:path';
import { ChapterReviewSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { chapterReviewFileName } from '../fileNames.js';
import { StepHandler, parseJson } from './types.js';

export const chapterReviewHandler: StepHandler = async (state, content) => {
  const parsed = ChapterReviewSchema.parse(parseJson(content));
  const failedAcceptance = Object.entries(parsed.acceptance)
    .filter(([, check]) => check.status === 'fail')
    .map(([key]) => key);
  const hasFailedAcceptance = failedAcceptance.length > 0;
  const hasIssues = parsed.issues.length > 0;
  if (parsed.acceptance.requiredBeats.missingBeats.length > 0 && parsed.acceptance.requiredBeats.status !== 'fail') {
    throw new Error('chapter_review requiredBeats must be fail when missingBeats is not empty');
  }
  if (parsed.status === 'clean' && (hasFailedAcceptance || hasIssues)) {
    throw new Error('chapter_review status clean requires all acceptance checks to pass and issues to be empty');
  }
  if (parsed.status === 'issues_found' && !hasIssues) {
    throw new Error('chapter_review status issues_found requires at least one issue');
  }
  if (hasFailedAcceptance && !hasIssues) {
    throw new Error(`chapter_review failed acceptance requires matching issues: ${failedAcceptance.join(', ')}`);
  }
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
