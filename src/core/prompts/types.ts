import { AgentState } from '../types.js';

export type PromptPurpose =
  | 'novel_metadata'
  | 'story_bible'
  | 'architecture'
  | 'chapter'
  | 'memory_card'
  | 'continuity_review'
  | 'chapter_review'
  | 'chapter_revision'
  | 'cross_chapter_review';

export interface PromptBuildInput {
  state: AgentState;
  context?: string;
}

export interface BuiltPrompt {
  purpose: PromptPurpose;
  prompt: string;
  expectedFormat: string;
}

export interface PromptPack {
  buildPromptForStep(input: PromptBuildInput): BuiltPrompt;
  strictJsonOutputRules(): string;
}
