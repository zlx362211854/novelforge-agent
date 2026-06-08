import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArchitectureExtensionPayloadSchema } from '../schemas.js';
import {
  AgentState,
  ChapterArchitecture,
  VolumeArchitecture,
  VolumePacingBoard,
} from '../types.js';
import { saveJsonFile, saveMarkdownFile } from '../projectStore.js';
import { StepHandler, parseJson } from './types.js';

async function readJsonArray<T>(projectPath: string, relativePath: string): Promise<T[]> {
  try {
    const raw = await readFile(join(projectPath, relativePath), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function assertContiguousExtension(
  state: AgentState,
  existing: ChapterArchitecture[],
  nextChapters: ChapterArchitecture[]
): void {
  const expectedStart = state.currentChapter;
  const total = state.plannedTotalChapters ?? state.targetChapters;
  const existingNumbers = new Set(existing.map((chapter) => chapter.chapterNumber));

  for (let index = 0; index < nextChapters.length; index += 1) {
    const chapter = nextChapters[index];
    const expected = expectedStart + index;
    if (chapter.chapterNumber !== expected) {
      throw new Error(`architecture_extension chapters must start at chapter ${expectedStart} and be contiguous; expected ${expected}, got ${chapter.chapterNumber}`);
    }
    if (chapter.chapterNumber > total) {
      throw new Error(`architecture_extension chapter ${chapter.chapterNumber} exceeds plannedTotalChapters ${total}`);
    }
    if (existingNumbers.has(chapter.chapterNumber)) {
      throw new Error(`architecture_extension cannot overwrite existing chapter architecture ${chapter.chapterNumber}`);
    }
  }
}

function mergeByKey<T>(existing: T[], incoming: T[] | undefined, keyOf: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of existing) map.set(keyOf(item), item);
  for (const item of incoming ?? []) map.set(keyOf(item), item);
  return [...map.values()];
}

export const architectureExtensionHandler: StepHandler = async (state, content) => {
  const parsed = ArchitectureExtensionPayloadSchema.parse(parseJson(content));
  const existingChapters = await readJsonArray<ChapterArchitecture>(state.projectPath, 'architecture/chapters.json');
  assertContiguousExtension(state, existingChapters, parsed.chapters);

  const chapters = [...existingChapters, ...parsed.chapters]
    .sort((a, b) => a.chapterNumber - b.chapterNumber);
  const existingVolumes = await readJsonArray<VolumeArchitecture>(state.projectPath, 'architecture/volumes.json');
  const volumes = mergeByKey(existingVolumes, parsed.volumes, (volume) => volume.id)
    .sort((a, b) => a.order - b.order);
  const existingPacing = await readJsonArray<VolumePacingBoard>(state.projectPath, 'architecture/volume-pacing.json');
  const volumePacing = mergeByKey(existingPacing, parsed.volumePacing, (board) => board.volumeId);

  const savedPaths = [
    await saveJsonFile(state.projectPath, 'architecture/chapters.json', chapters),
    await saveJsonFile(state.projectPath, 'architecture/volumes.json', volumes),
  ];

  const hasVolumePacing = Boolean(parsed.volumePacing || existingPacing.length);
  if (hasVolumePacing) {
    savedPaths.push(await saveJsonFile(state.projectPath, 'architecture/volume-pacing.json', volumePacing));
  }
  if (parsed.fullUpdate) {
    savedPaths.push(await saveMarkdownFile(state.projectPath, 'architecture/full.md', parsed.fullUpdate));
  }

  return {
    savedPaths,
    fileEntries: {
      architecture: 'architecture/chapters.json',
      ...(hasVolumePacing ? { volumePacing: 'architecture/volume-pacing.json' } : {}),
    },
    next: { kind: 'linear', nextStep: 'chapter' },
  };
};
