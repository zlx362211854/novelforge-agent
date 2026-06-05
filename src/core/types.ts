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
  | 'complete';

export type ReviewSeverity = 'low' | 'medium' | 'high';

export interface ChapterReviewIssue {
  severity: ReviewSeverity;
  category: 'character' | 'world' | 'timeline' | 'item' | 'knowledge' | 'pacing' | 'style' | 'architecture';
  description: string;
  evidence: string;
  suggestion: string;
}

export interface ChapterReview {
  chapterNumber: number;
  status: 'clean' | 'issues_found';
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

export interface ChapterArchitecture {
  chapterNumber: number;
  title: string;
  volumeId: string;
  summary: string;
  requiredBeats: string[];
}

export interface ArchitecturePayload {
  full: string;
  volumes: VolumeArchitecture[];
  chapters: ChapterArchitecture[];
}

export interface MemoryCard {
  summary: string;
  keyEvents: string[];
  entities: Array<{ name: string; type: string; state: string }>;
  facts: Array<{ subject: string; predicate: string; object: string }>;
  stateChanges: Array<{ entity: string; before: string; after: string }>;
  openThreads: string[];
}

export interface PendingAction {
  step: 'chapter_review' | 'chapter_revision' | 'cross_chapter_review';
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
