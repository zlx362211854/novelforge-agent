import { ContinuityReviewSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { StepHandler, parseJson } from './types.js';

export const continuityReviewHandler: StepHandler = async (state, content) => {
  const parsed = ContinuityReviewSchema.parse(parseJson(content));
  const relative = `reviews/continuity-${parsed.range.start}-${parsed.range.end}.json`;
  const path = await saveJsonFile(state.projectPath, relative, parsed);
  return {
    savedPaths: [path],
    fileEntries: { continuityReview: relative },
    next: { kind: 'linear', nextStep: 'complete' },
  };
};
