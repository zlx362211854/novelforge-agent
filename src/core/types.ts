export type WorkflowStep =
  | 'novel_metadata'
  | 'story_bible'
  | 'architecture'
  | 'chapter'
  | 'memory_card'
  | 'continuity_review'
  | 'chapter_review'
  | 'chapter_revision'
  | 'cross_chapter_review'
  | 'story_bible_amend'
  | 'complete';

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
  targetChapters: number;
  currentStep: WorkflowStep;
  currentChapter: number;
  completedSteps: WorkflowStep[];
  files: Record<string, string>;
  pendingAction?: PendingAction;
  createdAt: string;
  updatedAt: string;
}

export interface StepInstruction {
  projectId: string;
  projectPath: string;
  currentStep: WorkflowStep;
  instruction: string;
  expectedFormat: string;
  context: string;
}
