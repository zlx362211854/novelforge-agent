import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  archiveStoryBible,
  loadState,
  saveMarkdownFile,
  saveState,
} from './projectStore.js';
import { storyBibleVersionFileName } from './fileNames.js';
import { indexStoryBible } from './retrieval/index.js';

export interface AmendStoryBibleInput {
  projectPath: string;
  content: string;
  reason?: string;
}

export interface AmendStoryBibleResult {
  archivedPath?: string;
  bibleVersion: number;
  savedPath: string;
}

function isEmpty(content: string): boolean {
  return !content || !content.trim();
}

export async function amendStoryBible(input: AmendStoryBibleInput): Promise<AmendStoryBibleResult> {
  if (isEmpty(input.content)) throw new Error('Amended story bible content is empty');
  const state = await loadState(input.projectPath);
  // Archive current
  const archived = await archiveStoryBible(
    state.projectPath,
    join('story-bible-versions', storyBibleVersionFileName(new Date().toISOString()))
  );
  // Save new
  const savedPath = await saveMarkdownFile(state.projectPath, 'story-bible.md', input.content);
  // Re-index
  await indexStoryBible(state.projectPath, input.content);
  // Track in state
  const bibleVersion = (state.completedSteps.filter((s) => s === 'story_bible_amend').length ?? 0) + 1;
  await saveState({
    ...state,
    completedSteps: [...state.completedSteps, 'story_bible_amend' as const],
    files: { ...state.files, storyBible: 'story-bible.md' },
  });
  return { archivedPath: archived, bibleVersion, savedPath };
}

export async function listStoryBibleVersions(projectPath: string): Promise<string[]> {
  try {
    const items = await readdir(join(projectPath, 'story-bible-versions'));
    return items.filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
}
