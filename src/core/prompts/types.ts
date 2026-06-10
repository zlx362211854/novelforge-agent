import { AgentState } from '../types.js';

export type PromptPurpose =
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
  | 'story_bible_amend';

export interface PromptBuildInput {
  state: AgentState;
  context?: string;
}

export interface BuiltPromptSegment {
  id: string;
  text: string;
  cacheable: boolean;
  description?: string;
}

export interface BuiltPrompt {
  purpose: PromptPurpose;
  prompt: string;
  expectedFormat: string;
  /**
   * Optional structured prompt parts for cache-aware hosts.
   * If omitted, the workflow synthesizes a single non-cacheable segment
   * from `prompt`.
   */
  segments?: BuiltPromptSegment[];
}

export interface PromptPack {
  buildPromptForStep(input: PromptBuildInput): BuiltPrompt;
  strictJsonOutputRules(): string;
}
