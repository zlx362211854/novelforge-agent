export type WorkflowStep =
  | 'novel_metadata'
  | 'story_bible'
  | 'architecture'
  | 'chapter'
  | 'memory_card'
  | 'continuity_review'
  | 'complete';

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

export interface AgentState {
  projectId: string;
  projectPath: string;
  initialPrompt: string;
  targetChapters: number;
  currentStep: WorkflowStep;
  currentChapter: number;
  completedSteps: WorkflowStep[];
  files: Record<string, string>;
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
