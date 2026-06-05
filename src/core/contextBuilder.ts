import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chapterFileName, chapterReviewFileName, memoryFileName } from './fileNames.js';
import { formatHits, retrieve } from './retrieval/index.js';

export type ContextPurpose =
  | 'chapter_generation'
  | 'memory_extraction'
  | 'continuity_review'
  | 'revision'
  | 'chapter_review'
  | 'cross_chapter_review';

export interface BuildContextInput {
  projectPath: string;
  purpose: ContextPurpose;
  chapterNumber?: number;
  range?: { start: number; end: number };
  feedback?: string;
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
    let currentArchitectureForQuery: { summary?: string; requiredBeats?: string[]; title?: string } | undefined;
    if (chaptersJson) {
      const chapters = JSON.parse(chaptersJson) as Array<{ chapterNumber: number; title: string; summary: string; requiredBeats?: string[] }>;
      const chapter = chapters.find((item) => item.chapterNumber === input.chapterNumber);
      if (chapter) {
        currentArchitectureForQuery = chapter;
        parts.push(`## Current Chapter Architecture\n${JSON.stringify(chapter, null, 2)}`);
      }
    }
    if (input.chapterNumber > 1) {
      const previous = await readOptional(join(input.projectPath, 'chapters', chapterFileName(input.chapterNumber - 1)));
      const previousMemory = await readOptional(join(input.projectPath, 'memory', memoryFileName(input.chapterNumber - 1)));
      if (previous) parts.push(`## Previous Chapter Ending\n${previous.slice(-1600)}`);
      if (previousMemory) parts.push(`## Previous Chapter Memory\n${previousMemory}`);

      const queryPieces: string[] = [];
      if (currentArchitectureForQuery?.title) queryPieces.push(currentArchitectureForQuery.title);
      if (currentArchitectureForQuery?.summary) queryPieces.push(currentArchitectureForQuery.summary);
      if (currentArchitectureForQuery?.requiredBeats?.length) {
        queryPieces.push(currentArchitectureForQuery.requiredBeats.join(' '));
      }
      const query = queryPieces.join(' ').trim();
      if (query) {
        const hits = await retrieve(input.projectPath, query, {
          topK: 5,
          chapterRange: { start: 1, end: input.chapterNumber - 1 },
        });
        const formatted = formatHits(hits);
        if (formatted) parts.push(`## Retrieved Relevant Snippets (lexical, BM25-style)\n${formatted}`);
      }
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

  if (input.purpose === 'chapter_review' && input.chapterNumber) {
    if (chaptersJson) {
      const chapters = JSON.parse(chaptersJson) as Array<{ chapterNumber: number; title: string; summary: string; requiredBeats?: string[] }>;
      const arch = chapters.find((item) => item.chapterNumber === input.chapterNumber);
      if (arch) parts.push(`## Target Chapter Architecture\n${JSON.stringify(arch, null, 2)}`);
    }
    const chapter = await readOptional(join(input.projectPath, 'chapters', chapterFileName(input.chapterNumber)));
    if (chapter) parts.push(`## Chapter ${input.chapterNumber} Text\n${chapter}`);
    if (input.chapterNumber > 1) {
      const prevMemory = await readOptional(join(input.projectPath, 'memory', memoryFileName(input.chapterNumber - 1)));
      if (prevMemory) parts.push(`## Previous Chapter Memory\n${prevMemory}`);
    }
  }

  if (input.purpose === 'revision' && input.chapterNumber) {
    const chapter = await readOptional(join(input.projectPath, 'chapters', chapterFileName(input.chapterNumber)));
    if (chapter) parts.push(`## Current Chapter Text\n${chapter}`);
    const review = await readOptional(join(input.projectPath, 'reviews/chapter', chapterReviewFileName(input.chapterNumber)));
    if (review) parts.push(`## Editor Review\n${review}`);
    if (input.feedback) parts.push(`## Additional Feedback\n${input.feedback}`);
    if (input.chapterNumber > 1) {
      const previous = await readOptional(join(input.projectPath, 'chapters', chapterFileName(input.chapterNumber - 1)));
      if (previous) parts.push(`## Previous Chapter Ending\n${previous.slice(-1600)}`);
    }
  }

  if (input.purpose === 'cross_chapter_review' && input.range) {
    if (chaptersJson) parts.push(`## Chapter Architecture List\n${chaptersJson}`);
    const memoryParts: string[] = [];
    for (let i = input.range.start; i <= input.range.end; i += 1) {
      const memory = await readOptional(join(input.projectPath, 'memory', memoryFileName(i)));
      if (memory) memoryParts.push(`### Chapter ${i} Memory\n${memory}`);
    }
    if (memoryParts.length) parts.push(`## Memory Cards In Range\n${memoryParts.join('\n')}`);
    const tailParts: string[] = [];
    for (let i = input.range.start; i <= input.range.end; i += 1) {
      const chapter = await readOptional(join(input.projectPath, 'chapters', chapterFileName(i)));
      if (chapter) tailParts.push(`### Chapter ${i} Last 800 Chars\n${chapter.slice(-800)}`);
    }
    if (tailParts.length) parts.push(`## Chapter Tails\n${tailParts.join('\n')}`);
  }

  return parts.join('\n\n').trim();
}
