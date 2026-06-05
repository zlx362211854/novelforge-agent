import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import MiniSearch from 'minisearch';
import { MemoryCard } from '../types.js';
import { tokenize } from './tokenizer.js';
import { chunkChapter, chunkMemoryCard, chunkStoryBible } from './chunker.js';
import { RetrievalDoc, RetrievalHit, RetrieveOptions } from './types.js';

export type { RetrievalDoc, RetrievalDocType, RetrievalHit, RetrieveOptions } from './types.js';

const INDEX_PATH = '.index/lexical.json';
const MANIFEST_PATH = '.index/manifest.json';

const MINISEARCH_OPTIONS = {
  fields: ['text'],
  storeFields: ['type', 'chapterNumber', 'section', 'text'],
  tokenize: (text: string) => tokenize(text),
  processTerm: (term: string) => term,
  searchOptions: {
    tokenize: (text: string) => tokenize(text),
    processTerm: (term: string) => term,
    prefix: false,
    fuzzy: false,
    combineWith: 'OR' as const,
  },
};

interface IndexBundle {
  index: MiniSearch<RetrievalDoc>;
  ids: Set<string>;
}

async function loadBundle(projectPath: string): Promise<IndexBundle> {
  let index: MiniSearch<RetrievalDoc>;
  try {
    const raw = await readFile(join(projectPath, INDEX_PATH), 'utf8');
    index = MiniSearch.loadJSON<RetrievalDoc>(raw, MINISEARCH_OPTIONS);
  } catch {
    index = new MiniSearch<RetrievalDoc>(MINISEARCH_OPTIONS);
  }
  let ids = new Set<string>();
  try {
    const raw = await readFile(join(projectPath, MANIFEST_PATH), 'utf8');
    const parsed = JSON.parse(raw) as { ids?: string[] };
    if (Array.isArray(parsed.ids)) ids = new Set(parsed.ids);
  } catch {
    // manifest missing; bundle starts empty
  }
  return { index, ids };
}

async function persistBundle(projectPath: string, bundle: IndexBundle): Promise<void> {
  const indexFull = join(projectPath, INDEX_PATH);
  const manifestFull = join(projectPath, MANIFEST_PATH);
  await mkdir(dirname(indexFull), { recursive: true });
  await writeFile(indexFull, JSON.stringify(bundle.index), 'utf8');
  await writeFile(manifestFull, JSON.stringify({ ids: Array.from(bundle.ids).sort() }), 'utf8');
}

async function upsert(projectPath: string, removePredicate: (id: string) => boolean, docs: RetrievalDoc[]): Promise<void> {
  const bundle = await loadBundle(projectPath);
  const toRemove: string[] = [];
  for (const id of bundle.ids) {
    if (removePredicate(id)) toRemove.push(id);
  }
  for (const id of toRemove) {
    try {
      bundle.index.discard(id);
    } catch {
      // already absent
    }
    bundle.ids.delete(id);
  }
  if (toRemove.length) {
    await bundle.index.vacuum();
  }
  for (const doc of docs) {
    bundle.index.add(doc);
    bundle.ids.add(doc.id);
  }
  await persistBundle(projectPath, bundle);
}

export async function indexChapter(projectPath: string, chapterNumber: number, markdown: string): Promise<void> {
  const prefix = `chapter:${chapterNumber}:`;
  await upsert(projectPath, (id) => id.startsWith(prefix), chunkChapter(chapterNumber, markdown));
}

export async function indexStoryBible(projectPath: string, markdown: string): Promise<void> {
  await upsert(projectPath, (id) => id.startsWith('bible:'), chunkStoryBible(markdown));
}

export async function indexMemoryCard(projectPath: string, chapterNumber: number, card: MemoryCard): Promise<void> {
  const id = `memory:${chapterNumber}`;
  await upsert(projectPath, (existing) => existing === id, chunkMemoryCard(chapterNumber, card));
}

export async function retrieve(projectPath: string, query: string, options: RetrieveOptions = {}): Promise<RetrievalHit[]> {
  if (!query.trim()) return [];
  const bundle = await loadBundle(projectPath);
  const topK = options.topK ?? 6;
  const raw = bundle.index.search(query, {
    filter: (result: Record<string, unknown>) => {
      const type = result.type as string | undefined;
      const chapterNumber = result.chapterNumber as number | undefined;
      if (options.types && !options.types.includes(type as RetrievalHit['type'])) return false;
      if (options.chapterRange && typeof chapterNumber === 'number') {
        const { start, end } = options.chapterRange;
        if (chapterNumber < start || chapterNumber > end) return false;
      }
      return true;
    },
  });
  const hits: RetrievalHit[] = raw.slice(0, topK).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    type: r.type as RetrievalHit['type'],
    chapterNumber: r.chapterNumber as number | undefined,
    section: r.section as string | undefined,
    text: r.text as string,
    score: r.score as number,
  }));
  return hits;
}

export function formatHits(hits: RetrievalHit[]): string {
  if (!hits.length) return '';
  const lines: string[] = [];
  for (const hit of hits) {
    const tag =
      hit.type === 'chapter' ? `Chapter ${hit.chapterNumber}` :
      hit.type === 'memory' ? `Chapter ${hit.chapterNumber} Memory` :
      `Bible: ${hit.section}`;
    lines.push(`### ${tag} (score ${hit.score.toFixed(2)})\n${hit.text}`);
  }
  return lines.join('\n\n');
}
