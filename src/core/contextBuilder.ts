import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chapterFileName, memoryFileName } from './fileNames.js';

export type ContextPurpose =
  | 'chapter_generation'
  | 'memory_extraction'
  | 'continuity_review'
  | 'revision';

export interface BuildContextInput {
  projectPath: string;
  purpose: ContextPurpose;
  chapterNumber?: number;
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

export async function buildContext(input: BuildContextInput): Promise<string> {
  const parts: string[] = [];
  const metadata = await readOptional(join(input.projectPath, 'novel.json'));
  const storyBible = await readOptional(join(input.projectPath, 'story-bible.md'));
  const chaptersJson = await readOptional(join(input.projectPath, 'architecture/chapters.json'));

  if (metadata) parts.push(`## Novel Metadata\n${metadata}`);
  if (storyBible) parts.push(`## Story Bible\n${storyBible.slice(0, 4000)}`);

  if (input.purpose === 'chapter_generation' && input.chapterNumber) {
    if (chaptersJson) {
      const chapters = JSON.parse(chaptersJson) as Array<{ chapterNumber: number; title: string; summary: string }>;
      const chapter = chapters.find((item) => item.chapterNumber === input.chapterNumber);
      if (chapter) parts.push(`## Current Chapter Architecture\n${JSON.stringify(chapter, null, 2)}`);
    }
    if (input.chapterNumber > 1) {
      const previous = await readOptional(join(input.projectPath, 'chapters', chapterFileName(input.chapterNumber - 1)));
      const previousMemory = await readOptional(join(input.projectPath, 'memory', memoryFileName(input.chapterNumber - 1)));
      if (previous) parts.push(`## Previous Chapter Ending\n${previous.slice(-1600)}`);
      if (previousMemory) parts.push(`## Previous Chapter Memory\n${previousMemory}`);
    }
  }

  if (input.purpose === 'memory_extraction' && input.chapterNumber) {
    const chapter = await readOptional(join(input.projectPath, 'chapters', chapterFileName(input.chapterNumber)));
    if (chapter) parts.push(`## Current Chapter\n${chapter}`);
  }

  if (input.purpose === 'continuity_review') {
    if (chaptersJson) parts.push(`## Chapter Architecture List\n${chaptersJson}`);
    const memoryParts: string[] = [];
    for (let i = 1; i <= 20; i += 1) {
      const memory = await readOptional(join(input.projectPath, 'memory', memoryFileName(i)));
      if (memory) memoryParts.push(`### Chapter ${i}\n${memory}`);
    }
    if (memoryParts.length) parts.push(`## Memory Cards\n${memoryParts.join('\n')}`);
  }

  return parts.join('\n\n').trim();
}
