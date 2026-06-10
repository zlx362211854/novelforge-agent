import { join } from 'node:path';
import { ChapterReviewSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { chapterReviewFileName } from '../fileNames.js';
import { StepHandler, parseJson } from './types.js';

export const MAX_REVISION_ROUNDS = 3;

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
    // Successful review: clear any prior revision counter for this chapter.
    const cleanedCounts = { ...(state.revisionCounts ?? {}) };
    delete cleanedCounts[target];
    return {
      savedPaths: [path],
      fileEntries: { [`review-chapter-${target}`]: relative },
      next: {
        kind: 'linear',
        nextStep: 'memory_card',
        statePatch: { revisionCounts: cleanedCounts },
      },
    };
  }

  // issues_found / failed acceptance — decide revise vs force-advance based on
  // how many revision rounds this chapter has already been through.
  const currentCount = state.revisionCounts?.[target] ?? 0;
  if (currentCount >= MAX_REVISION_ROUNDS) {
    const cleanedCounts = { ...(state.revisionCounts ?? {}) };
    delete cleanedCounts[target];
    const nextForceAdvanced = Array.from(new Set([...(state.forceAdvanced ?? []), target]));
    return {
      savedPaths: [path],
      fileEntries: { [`review-chapter-${target}`]: relative },
      next: {
        kind: 'linear',
        nextStep: 'memory_card',
        statePatch: {
          revisionCounts: cleanedCounts,
          forceAdvanced: nextForceAdvanced,
        },
      },
    };
  }

  return {
    savedPaths: [path],
    fileEntries: { [`review-chapter-${target}`]: relative },
    next: {
      kind: 'linear',
      nextStep: 'chapter_revision',
      statePatch: {
        revisionCounts: {
          ...(state.revisionCounts ?? {}),
          [target]: currentCount + 1,
        },
        pendingAction: {
          step: 'chapter_revision',
          mode: 'gate',
          chapterNumber: target,
        },
      },
    },
  };
};
