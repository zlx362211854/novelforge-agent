import { access, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { NovelMetadataSchema } from '../schemas.js';
import { saveJsonFile } from '../projectStore.js';
import { initializeCharacterStates } from '../characterStore.js';
import { makeProjectSlug } from '../fileNames.js';
import { StepHandler, parseJson } from './types.js';

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

async function renameProjectForTitle(projectPath: string, title: string): Promise<string> {
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

export const novelMetadataHandler: StepHandler = async (state, content) => {
  const parsed = NovelMetadataSchema.parse(parseJson(content));
  const path = await saveJsonFile(state.projectPath, 'novel.json', parsed);
  const charactersPath = await initializeCharacterStates(state.projectPath, parsed.coreCast);
  const projectPath = await renameProjectForTitle(state.projectPath, parsed.title);
  return {
    savedPaths: [
      projectPath === state.projectPath ? path : join(projectPath, 'novel.json'),
      projectPath === state.projectPath ? charactersPath : join(projectPath, 'characters.json'),
    ],
    fileEntries: { novel: 'novel.json', characters: 'characters.json' },
    next: {
      kind: 'linear',
      nextStep: 'story_bible',
      statePatch: { projectPath },
    },
  };
};
