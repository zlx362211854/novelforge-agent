import { WorkflowStep } from '../types.js';
import { architectureExtensionHandler } from './architectureExtension.js';
import { architectureHandler } from './architecture.js';
import { chapterHandler } from './chapter.js';
import { chapterReviewHandler } from './chapterReview.js';
import { chapterRevisionHandler } from './chapterRevision.js';
import { continuityReviewHandler } from './continuityReview.js';
import { crossChapterReviewHandler } from './crossChapterReview.js';
import { memoryCardHandler } from './memoryCard.js';
import { novelMetadataHandler } from './novelMetadata.js';
import { styleGuideHandler } from './styleGuide.js';
import { storyBibleHandler } from './storyBible.js';
import { StepHandler } from './types.js';

export type { StepApplyNext, StepApplyResult, StepHandler } from './types.js';

export const STEP_HANDLERS: Partial<Record<WorkflowStep, StepHandler>> = {
  novel_metadata: novelMetadataHandler,
  story_bible: storyBibleHandler,
  style_guide: styleGuideHandler,
  architecture: architectureHandler,
  architecture_extension: architectureExtensionHandler,
  chapter: chapterHandler,
  memory_card: memoryCardHandler,
  continuity_review: continuityReviewHandler,
  chapter_review: chapterReviewHandler,
  chapter_revision: chapterRevisionHandler,
  cross_chapter_review: crossChapterReviewHandler,
};
