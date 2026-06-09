import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NovelMetadataSchema } from './schemas.js';
import { NovelMetadata } from './types.js';
import {
  loadState,
  renameProjectForTitle,
  saveJsonFile,
  saveState,
} from './projectStore.js';

export interface AmendNovelMetadataInput {
  projectPath: string;
  content?: string;
  title?: string;
  genre?: string;
  premise?: string;
  language?: string;
  style?: string;
  coreCast?: NovelMetadata['coreCast'];
  reason?: string;
}

export interface AmendNovelMetadataResult {
  oldProjectPath: string;
  projectPath: string;
  renamed: boolean;
  savedPath: string;
  statePath: string;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

async function loadCurrentMetadata(projectPath: string): Promise<NovelMetadata> {
  const raw = await readFile(join(projectPath, 'novel.json'), 'utf8');
  return NovelMetadataSchema.parse(JSON.parse(raw));
}

export async function amendNovelMetadata(input: AmendNovelMetadataInput): Promise<AmendNovelMetadataResult> {
  const state = await loadState(input.projectPath);
  const base = input.content
    ? NovelMetadataSchema.parse(JSON.parse(input.content))
    : await loadCurrentMetadata(state.projectPath);

  const patch = {
    ...(present(input.title) ? { title: input.title } : {}),
    ...(present(input.genre) ? { genre: input.genre } : {}),
    ...(present(input.premise) ? { premise: input.premise } : {}),
    ...(present(input.language) ? { language: input.language } : {}),
    ...(present(input.style) ? { style: input.style } : {}),
    ...(present(input.coreCast) ? { coreCast: input.coreCast } : {}),
  };

  if (!input.content && Object.keys(patch).length === 0) {
    throw new Error('amend_novel_metadata requires content or at least one metadata field to update');
  }

  const nextMetadata = NovelMetadataSchema.parse({ ...base, ...patch });
  const oldProjectPath = state.projectPath;
  await saveJsonFile(oldProjectPath, 'novel.json', nextMetadata);

  const projectPath = await renameProjectForTitle(oldProjectPath, nextMetadata.title);
  const nextState = {
    ...state,
    projectPath,
    completedSteps: [...state.completedSteps, 'novel_metadata_amend' as const],
    files: { ...state.files, novel: 'novel.json' },
  };
  await saveState(nextState);

  return {
    oldProjectPath,
    projectPath,
    renamed: projectPath !== oldProjectPath,
    savedPath: join(projectPath, 'novel.json'),
    statePath: join(projectPath, 'agent-state.json'),
  };
}
