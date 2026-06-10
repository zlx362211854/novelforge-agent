export type WorkflowStep =
  | 'novel_metadata'
  | 'story_bible'
  | 'style_guide'
  | 'architecture'
  | 'architecture_extension'
  | 'chapter'
  | 'memory_card'
  | 'continuity_review'
  | 'chapter_review'
  | 'chapter_revision'
  | 'cross_chapter_review'
  | 'novel_metadata_amend'
  | 'story_bible_amend'
  | 'complete';

export type NovelLengthPreset = 'short' | 'medium' | 'long';

export type ReviewSeverity = 'low' | 'medium' | 'high';

export interface ChapterReviewIssue {
  severity: ReviewSeverity;
  category:
    | 'character'
    | 'world'
    | 'timeline'
    | 'item'
    | 'knowledge'
    | 'pacing'
    | 'style'
    | 'architecture'
    | 'plot'
    | 'foreshadow'
    | 'hook'
    | 'repetition';
  description: string;
  evidence: string;
  suggestion: string;
}

export interface ChapterAcceptanceCheck {
  status: 'pass' | 'fail';
  evidence: string;
}

export interface ChapterAcceptanceGate {
  requiredBeats: ChapterAcceptanceCheck & { missingBeats: string[] };
  narrativeProgress: ChapterAcceptanceCheck;
  characterProgress: ChapterAcceptanceCheck;
  foreshadowProgress: ChapterAcceptanceCheck;
  storyBibleConsistency: ChapterAcceptanceCheck;
  proseRhythm: ChapterAcceptanceCheck;
  endingHook: ChapterAcceptanceCheck;
  repetition: ChapterAcceptanceCheck;
}

export interface ChapterReview {
  chapterNumber: number;
  status: 'clean' | 'issues_found';
  acceptance: ChapterAcceptanceGate;
  issues: ChapterReviewIssue[];
}

export interface CrossChapterReview {
  range: { start: number; end: number };
  status: 'clean' | 'issues_found';
  issues: Array<{
    severity: ReviewSeverity;
    chapters: number[];
    description: string;
    evidence: string;
    suggestion: string;
  }>;
}

export interface CoreCastMember {
  name: string;
  role: string;
  description: string;
}

export interface NovelMetadata {
  title: string;
  genre: string;
  premise: string;
  language: string;
  style: string;
  coreCast: CoreCastMember[];
}

export interface StyleGuide {
  narrativeVoice: string;
  pacing: string;
  diction: string;
  dialogueRules: string[];
  prohibitedPatterns: string[];
  proseRhythm: {
    sentenceRhythm: string;
    paragraphing: string;
    interiorityMode: string;
    emphasisBudget: string;
    antiPatterns: string[];
  };
  sampleParagraph: string;
  consistencyChecks: string[];
}

export interface VolumeArchitecture {
  id: string;
  title: string;
  summary: string;
  order: number;
}

export interface VolumePacingBoard {
  volumeId: string;
  start: string;
  promise: string;
  keyTurns: string[];
  midpoint: string;
  climax: string;
  payoffs: string[];
  lingeringMysteries: string[];
}

export type EndHookFocus = 'cliffhanger' | 'mystery' | 'emotional' | 'reveal' | 'volume_close' | 'gentle';

export interface ChapterArchitecture {
  chapterNumber: number;
  title: string;
  volumeId: string;
  summary: string;
  requiredBeats: string[];
  targetWords?: number;
  requireRecap?: boolean;
  endHookFocus?: EndHookFocus;
  povCharacter?: string;
}

export interface ArchitecturePayload {
  full: string;
  volumes: VolumeArchitecture[];
  volumePacing?: VolumePacingBoard[];
  chapters: ChapterArchitecture[];
}

export interface ArchitectureExtensionPayload {
  fullUpdate?: string;
  volumes?: VolumeArchitecture[];
  volumePacing?: VolumePacingBoard[];
  chapters: ChapterArchitecture[];
}

export type ThreadStatus = 'planted' | 'building' | 'paid' | 'dropped';

export type ThreadActionKind = 'plant' | 'build' | 'pay' | 'drop';

export interface ThreadAction {
  kind: ThreadActionKind;
  threadId?: string;     // existing thread id; required for build/pay/drop
  description: string;   // for plant: the new thread description; for others: how this chapter touched it
}

export interface Thread {
  id: string;
  description: string;
  status: ThreadStatus;
  plantedAt: number;
  lastTouchedAt: number;
  plannedPayoffAt?: number;
  paidOffAt?: number;
  droppedAt?: number;
  notes?: string;
}

export interface CharacterRelationshipState {
  name: string;
  dynamic: string;
}

export interface CharacterState {
  name: string;
  role?: string;
  goal: string;
  belief: string;
  relationships: CharacterRelationshipState[];
  abilities: string[];
  secrets: string[];
  emotionalState: string;
  lastUpdatedAt: number;
}

export interface CharacterStateUpdate {
  name: string;
  role?: string;
  goal?: string;
  belief?: string;
  relationships?: CharacterRelationshipState[];
  abilities?: string[];
  secrets?: string[];
  emotionalState?: string;
}

export interface MemoryCard {
  summary: string;
  keyEvents: string[];
  entities: Array<{ name: string; type: string; state: string }>;
  facts: Array<{ subject: string; predicate: string; object: string }>;
  stateChanges: Array<{ entity: string; before: string; after: string }>;
  openThreads: string[];
  wordCount?: number;
  threadActions?: ThreadAction[];
  characterUpdates?: CharacterStateUpdate[];
}

export interface PendingAction {
  step: 'chapter_review' | 'chapter_revision' | 'cross_chapter_review';
  mode?: 'side_track' | 'gate';
  chapterNumber?: number;
  range?: { start: number; end: number };
  feedback?: string;
}

export interface AgentState {
  projectId: string;
  projectPath: string;
  initialPrompt: string;
  language: 'zh-CN' | 'en-US';
  /**
   * Number of chapters to plan in each architecture batch.
   * The whole-book target lives in plannedTotalChapters.
   */
  targetChapters: number;
  lengthPreset?: NovelLengthPreset;
  plannedTotalChapters: number;
  currentStep: WorkflowStep;
  currentChapter: number;
  completedSteps: WorkflowStep[];
  files: Record<string, string>;
  pendingAction?: PendingAction;
  /**
   * Per-chapter revision attempt counter. Incremented every time the
   * chapter_review → chapter_revision gate cycles. Once a chapter's count
   * reaches MAX_REVISION_ROUNDS the workflow auto-advances to memory_card
   * and the chapter number is appended to forceAdvanced for the user's record.
   */
  revisionCounts?: Record<number, number>;
  /**
   * Chapters that exited the review→revise loop because they hit the
   * revision cap with unresolved issues. Surfaced in get_project_status.
   */
  forceAdvanced?: number[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A hint to the host about which model tier suits a step.
 * - 'cheap':    extractive / structured (memory_card-like). Haiku-class.
 * - 'standard': analytical / constrained (reviews, JSON gen). Sonnet-class.
 * - 'premium':  creative prose. Sonnet+ / Opus.
 *
 * Hosts are not required to obey but can use this to route to cheaper models
 * on lightweight steps and save tokens.
 */
export type ModelHint = 'cheap' | 'standard' | 'premium';

/**
 * A piece of the prompt with a hint about whether the host can cache it
 * across many calls of the same step.
 *
 * - cacheable=true segments are stable text (rules, audit tables, schema
 *   templates). Hosts that support prompt caching (e.g. Anthropic API
 *   cache_control) can mark these blocks ephemeral / extended.
 * - cacheable=false segments are per-call data (current chapter number,
 *   retrieved snippets, last chapter ending). Send fresh each call.
 *
 * Segments are concatenated (in order, separated by blank lines) to form
 * StepInstruction.instruction for backward compatibility.
 */
export interface PromptSegment {
  id: string;
  text: string;
  cacheable: boolean;
  description?: string;
}

export interface StepInstruction {
  projectId: string;
  projectPath: string;
  currentStep: WorkflowStep;
  /** Full concatenated instruction text (back-compat). */
  instruction: string;
  expectedFormat: string;
  context: string;
  /** Structured prompt parts. Cache-aware hosts should use these. */
  segments: PromptSegment[];
  /** Suggested model tier for this step. */
  modelHint: ModelHint;
}
