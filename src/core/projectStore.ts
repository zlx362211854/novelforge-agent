import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { AgentState } from './types.js';
import { makeProjectSlug } from './fileNames.js';

export interface CreateProjectInput {
  workspaceRoot: string;
  prompt: string;
  language?: AgentState['language'];
  outputDir?: string;
  targetChapters?: number;
  plannedTotalChapters?: number;
}

export interface CreateProjectResult {
  state: AgentState;
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string): void {
  const root = resolve(workspaceRoot);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to write outside workspace: ${target}`);
  }
}

export async function ensureProjectDirectories(projectPath: string): Promise<void> {
  await mkdir(projectPath, { recursive: true });
  await mkdir(join(projectPath, 'architecture'), { recursive: true });
  await mkdir(join(projectPath, 'chapters'), { recursive: true });
  await mkdir(join(projectPath, 'chapters/.versions'), { recursive: true });
  await mkdir(join(projectPath, 'story-bible-versions'), { recursive: true });
  await mkdir(join(projectPath, 'memory'), { recursive: true });
  await mkdir(join(projectPath, 'reviews'), { recursive: true });
  await mkdir(join(projectPath, 'reviews/chapter'), { recursive: true });
  await mkdir(join(projectPath, 'reviews/cross'), { recursive: true });
  await mkdir(join(projectPath, '.agent-recovery'), { recursive: true });
  await mkdir(join(projectPath, '.agent-logs'), { recursive: true });
}

export async function archiveChapterVersion(projectPath: string, chapterRelative: string, versionRelative: string): Promise<string | undefined> {
  const sourcePath = join(projectPath, chapterRelative);
  try {
    const existing = await readFile(sourcePath, 'utf8');
    return saveMarkdownFile(projectPath, versionRelative, existing);
  } catch {
    return undefined;
  }
}

export async function archiveStoryBible(projectPath: string, versionRelative: string): Promise<string | undefined> {
  const sourcePath = join(projectPath, 'story-bible.md');
  try {
    const existing = await readFile(sourcePath, 'utf8');
    return saveMarkdownFile(projectPath, versionRelative, existing);
  } catch {
    return undefined;
  }
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const baseDir = input.outputDir || 'novels';
  const hasExplicitTargetChapters = input.targetChapters !== undefined;
  const targetChapters = Math.max(1, Math.floor(Number(input.targetChapters || 5)));
  const plannedTotalChapters = Math.max(
    targetChapters,
    Math.floor(Number(input.plannedTotalChapters ?? (hasExplicitTargetChapters ? targetChapters : 12)))
  );
  const baseSlug = makeProjectSlug(input.prompt.slice(0, 48));
  const suffix = randomBytes(3).toString('hex');
  const slug = `${baseSlug}-${suffix}`;
  const projectPath = resolve(workspaceRoot, baseDir, slug);
  assertInsideWorkspace(workspaceRoot, projectPath);
  await ensureProjectDirectories(projectPath);

  const now = new Date().toISOString();
  const state: AgentState = {
    projectId: randomUUID(),
    projectPath,
    initialPrompt: input.prompt,
    language: input.language || 'zh-CN',
    targetChapters,
    plannedTotalChapters,
    currentStep: 'novel_metadata',
    currentChapter: 1,
    completedSteps: [],
    files: {},
    createdAt: now,
    updatedAt: now,
  };
  await saveState(state);
  return { state };
}

export async function loadState(projectPath: string): Promise<AgentState> {
  const raw = await readFile(join(projectPath, 'agent-state.json'), 'utf8');
  return JSON.parse(raw) as AgentState;
}

export async function saveState(state: AgentState): Promise<void> {
  const nextState = { ...state, updatedAt: new Date().toISOString() };
  await writeFile(
    join(state.projectPath, 'agent-state.json'),
    `${JSON.stringify(nextState, null, 2)}\n`,
    'utf8'
  );
}

export async function saveJsonFile(projectPath: string, relativePath: string, value: unknown): Promise<string> {
  const fullPath = join(projectPath, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return fullPath;
}

export async function saveMarkdownFile(projectPath: string, relativePath: string, value: string): Promise<string> {
  const fullPath = join(projectPath, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
  return fullPath;
}

export async function saveRecoveryFile(projectPath: string, step: string, content: string): Promise<string> {
  const safeStep = step.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const fileName = `.agent-recovery/failed-${safeStep}-${Date.now()}.txt`;
  return saveMarkdownFile(projectPath, fileName, content);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function uniqueProjectPath(parentDir: string, baseName: string, currentPath: string): Promise<string> {
  let candidate = join(parentDir, baseName);
  if (candidate === currentPath || !(await pathExists(candidate))) return candidate;

  for (let index = 2; index < 100; index += 1) {
    candidate = join(parentDir, `${baseName}-${index}`);
    if (candidate === currentPath || !(await pathExists(candidate))) return candidate;
  }

  throw new Error(`Unable to find available project directory for ${baseName}`);
}

export async function renameProjectForTitle(projectPath: string, title: string): Promise<string> {
  const parentDir = dirname(projectPath);
  const currentName = basename(projectPath);
  const suffix = currentName.match(/-([a-f0-9]{6})$/i)?.[1];
  const titleSlug = makeProjectSlug(title);
  const nextName = suffix ? `${titleSlug}-${suffix}` : titleSlug;
  if (nextName === currentName) return projectPath;

  const nextPath = await uniqueProjectPath(parentDir, nextName, projectPath);
  if (nextPath === projectPath) return projectPath;
  await rename(projectPath, nextPath);
  return nextPath;
}
