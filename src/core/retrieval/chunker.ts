import { MemoryCard } from '../types.js';
import { RetrievalDoc } from './types.js';

const PARAGRAPH_MIN_CHARS = 40;
const PARAGRAPH_MAX_CHARS = 600;

function splitMarkdownParagraphs(markdown: string): string[] {
  const stripped = markdown.replace(/^#[^\n]*\n?/, ''); // drop leading H1 title
  const raw = stripped.split(/\n\s*\n+/);
  const merged: string[] = [];
  for (const part of raw) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.length < PARAGRAPH_MIN_CHARS && merged.length) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n${trimmed}`;
    } else {
      merged.push(trimmed);
    }
  }
  // Cap super-long paragraphs into halves so a single 3000-char block does not dominate.
  const capped: string[] = [];
  for (const para of merged) {
    if (para.length <= PARAGRAPH_MAX_CHARS) {
      capped.push(para);
      continue;
    }
    for (let i = 0; i < para.length; i += PARAGRAPH_MAX_CHARS) {
      capped.push(para.slice(i, i + PARAGRAPH_MAX_CHARS));
    }
  }
  return capped;
}

export function chunkChapter(chapterNumber: number, markdown: string): RetrievalDoc[] {
  const paragraphs = splitMarkdownParagraphs(markdown);
  return paragraphs.map((text, index) => ({
    id: `chapter:${chapterNumber}:p:${index}`,
    type: 'chapter',
    chapterNumber,
    text,
  }));
}

export function chunkStoryBible(markdown: string): RetrievalDoc[] {
  const sections = markdown.split(/^##\s+/m);
  const docs: RetrievalDoc[] = [];
  sections.forEach((section, index) => {
    const trimmed = section.trim();
    if (!trimmed) return;
    const newlineIdx = trimmed.indexOf('\n');
    const heading = newlineIdx > -1 ? trimmed.slice(0, newlineIdx).trim() : `section-${index}`;
    const body = newlineIdx > -1 ? trimmed.slice(newlineIdx + 1).trim() : '';
    if (!body) return;
    docs.push({
      id: `bible:${index}:${heading}`,
      type: 'bible',
      section: heading,
      text: `${heading}\n${body}`,
    });
  });
  return docs;
}

export function chunkMemoryCard(chapterNumber: number, card: MemoryCard): RetrievalDoc[] {
  const lines = [
    `chapter ${chapterNumber} summary`,
    card.summary,
    ...card.keyEvents.map((event) => `event: ${event}`),
    ...card.facts.map((f) => `fact: ${f.subject} ${f.predicate} ${f.object}`),
    ...card.stateChanges.map((s) => `state: ${s.entity} ${s.before} -> ${s.after}`),
    ...card.entities.map((e) => `entity ${e.type}: ${e.name} - ${e.state}`),
    ...card.openThreads.map((thread) => `open: ${thread}`),
  ];
  return [{
    id: `memory:${chapterNumber}`,
    type: 'memory',
    chapterNumber,
    text: lines.join('\n'),
  }];
}
