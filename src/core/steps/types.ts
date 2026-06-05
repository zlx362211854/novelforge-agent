import { AgentState, WorkflowStep } from '../types.js';

export type StepApplyNext =
  | { kind: 'linear'; nextStep: WorkflowStep; statePatch?: Partial<AgentState> }
  | { kind: 'sideTrackReturn' };

export interface StepApplyResult {
  savedPaths: string[];
  fileEntries?: Record<string, string>;
  next: StepApplyNext;
}

export type StepHandler = (state: AgentState, content: string) => Promise<StepApplyResult>;

export function parseJson(content: string): unknown {
  return JSON.parse(content);
}

export function requireNonEmpty(content: string, label: string): void {
  if (!content.trim()) throw new Error(`${label} is empty`);
}
