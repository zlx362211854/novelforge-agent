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

const PACING_OVERLOAD_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'major truth reveal', pattern: /真相|揭示|揭露|reveals?|truth|core secret/i },
  { label: 'major power jump', pattern: /连破|连续突破|突破[^。.!?]{0,24}(层|境|级)|breakthrough|power jump/i },
  { label: 'major battle', pattern: /大战|决战|激战|围攻|boss|showdown|all-out fight/i },
  { label: 'core payoff', pattern: /回收|解开|解封|payoff|resolved|unlock/i },
  { label: 'new arc launch', pattern: /新地图|北极|冰原|new region|new arc|next arc/i },
  { label: 'top antagonist escalation', pattern: /殿主亲至|最终反派|堂主|宗主|final villain|chief antagonist/i },
];

function assertPacingGuardrails(state: AgentState, nextChapters: ChapterArchitecture[]): void {
  const total = state.plannedTotalChapters ?? state.targetChapters;
  for (const chapter of nextChapters) {
    if (chapter.chapterNumber >= total) continue;
    const text = `${chapter.title}\n${chapter.summary}\n${chapter.requiredBeats.join('\n')}`;
    const hits = PACING_OVERLOAD_PATTERNS
      .filter(({ pattern }) => pattern.test(text))
      .map(({ label }) => label);
    if (hits.length >= 4) {
      throw new Error(
        `architecture_extension chapter ${chapter.chapterNumber} is overloaded for a non-final chapter: ${hits.join(', ')}. Split major reveals, payoffs, power jumps, battles, and new-arc launches across multiple chapters.`
      );
    }
  }
}

export const architectureExtensionHandler: StepHandler = async (state, content) => {
  const parsed = ArchitectureExtensionPayloadSchema.parse(parseJson(content));
  const existingChapters = await readJsonArray<ChapterArchitecture>(state.projectPath, 'architecture/chapters.json');
  assertContiguousExtension(state, existingChapters, parsed.chapters);
  assertPacingGuardrails(state, parsed.chapters);

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
