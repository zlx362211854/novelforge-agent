import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AgentState, NovelMetadata, WorkflowStep } from './types.js';
import { loadState } from './projectStore.js';

export interface ProjectSummary {
  projectId: string;
  projectPath: string;
  title?: string;
  genre?: string;
  language: AgentState['language'];
  currentStep: WorkflowStep;
  currentChapter: number;
  targetChapters: number;
  plannedTotalChapters: number;
  completedSteps: number;
  chaptersWritten: number;
  updatedAt: string;
  createdAt: string;
}

export interface ListProjectsInput {
  workspaceRoot: string;
  outputDir?: string;
}

async function readMetadata(projectPath: string): Promise<NovelMetadata | undefined> {
  try {
    const raw = await readFile(join(projectPath, 'novel.json'), 'utf8');
    return JSON.parse(raw) as NovelMetadata;
  } catch {
    return undefined;
  }
}

function countChapters(state: AgentState): number {
  let count = 0;
  for (const key of Object.keys(state.files)) {
    if (/^chapter-\d+$/.test(key)) count += 1;
  }
  return count;
}

async function summarizeOne(projectPath: string): Promise<ProjectSummary | undefined> {
  let state: AgentState;
  try {
    state = await loadState(projectPath);
  } catch {
    return undefined;
  }
  const metadata = await readMetadata(projectPath);
  return {
    projectId: state.projectId,
    projectPath,
    title: metadata?.title,
    genre: metadata?.genre,
    language: state.language,
    currentStep: state.currentStep,
    currentChapter: state.currentChapter,
    targetChapters: state.targetChapters,
    plannedTotalChapters: state.plannedTotalChapters ?? state.targetChapters,
    completedSteps: state.completedSteps.length,
    chaptersWritten: countChapters(state),
    updatedAt: state.updatedAt,
    createdAt: state.createdAt,
  };
}

export async function listProjects(input: ListProjectsInput): Promise<ProjectSummary[]> {
  const root = resolve(input.workspaceRoot, input.outputDir ?? 'novels');
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const summaries = await Promise.all(
    entries.map((entry) => summarizeOne(join(root, entry)))
  );
  return summaries
    .filter((s): s is ProjectSummary => Boolean(s))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface ProjectStatus extends ProjectSummary {
  pendingAction?: AgentState['pendingAction'];
  files: Record<string, string>;
  openThreads: string[];
  latestReview?: {
    type: 'chapter' | 'cross' | 'continuity';
    path: string;
    status?: string;
    chapterNumber?: number;
    range?: { start: number; end: number };
    issueCount?: number;
  };
  revisionCounts: Record<number, number>;
  forceAdvanced: number[];
  done: boolean;
}

async function findLatestReview(projectPath: string, files: Record<string, string>): Promise<ProjectStatus['latestReview']> {
  const keys = Object.keys(files);
  const chapterReviewKeys = keys.filter((k) => k.startsWith('review-chapter-'));
  const crossReviewKeys = keys.filter((k) => k.startsWith('review-cross-'));
  const continuityReviewKey = files.continuityReview;

  type Candidate = { type: 'chapter' | 'cross' | 'continuity'; relative: string; key: string };
  const candidates: Candidate[] = [];
  for (const key of chapterReviewKeys) candidates.push({ type: 'chapter', relative: files[key], key });
  for (const key of crossReviewKeys) candidates.push({ type: 'cross', relative: files[key], key });
  if (continuityReviewKey) candidates.push({ type: 'continuity', relative: continuityReviewKey, key: 'continuityReview' });
  if (!candidates.length) return undefined;

  // pick the most-recently-modified one by reading mtimes; fall back to last in map order
  const { stat } = await import('node:fs/promises');
  let best: { c: Candidate; mtime: number } | undefined;
  for (const c of candidates) {
    try {
      const s = await stat(join(projectPath, c.relative));
      if (!best || s.mtimeMs > best.mtime) best = { c, mtime: s.mtimeMs };
    } catch {
      // skip missing files
    }
  }
  if (!best) return undefined;
  try {
    const raw = await readFile(join(projectPath, best.c.relative), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      type: best.c.type,
      path: best.c.relative,
      status: parsed?.status,
      chapterNumber: parsed?.chapterNumber,
      range: parsed?.range,
      issueCount: Array.isArray(parsed?.issues) ? parsed.issues.length : undefined,
    };
  } catch {
    return { type: best.c.type, path: best.c.relative };
  }
}

async function collectOpenThreads(projectPath: string, state: AgentState): Promise<string[]> {
  const threads: string[] = [];
  const memoryKeys = Object.keys(state.files).filter((k) => /^memory-\d+$/.test(k));
  for (const key of memoryKeys) {
    try {
      const raw = await readFile(join(projectPath, state.files[key]), 'utf8');
      const parsed = JSON.parse(raw) as { openThreads?: string[] };
      if (Array.isArray(parsed.openThreads)) {
        for (const thread of parsed.openThreads) {
          if (thread && !threads.includes(thread)) threads.push(thread);
        }
      }
    } catch {
      // ignore
    }
  }
  return threads;
}

export async function getProjectStatus(projectPath: string): Promise<ProjectStatus> {
  const summary = await summarizeOne(projectPath);
  if (!summary) throw new Error(`Not a NovelForge project: ${projectPath}`);
  const state = await loadState(projectPath);
  const [latestReview, openThreads] = await Promise.all([
    findLatestReview(projectPath, state.files),
    collectOpenThreads(projectPath, state),
  ]);
  return {
    ...summary,
    pendingAction: state.pendingAction,
    files: state.files,
    openThreads,
    latestReview,
    revisionCounts: state.revisionCounts ?? {},
    forceAdvanced: state.forceAdvanced ?? [],
    done: state.currentStep === 'complete',
  };
}
