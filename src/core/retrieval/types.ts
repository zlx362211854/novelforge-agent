export type RetrievalDocType = 'chapter' | 'bible' | 'memory';

export interface RetrievalDoc {
  id: string;
  type: RetrievalDocType;
  chapterNumber?: number;
  section?: string;
  text: string;
}

export interface RetrievalHit {
  id: string;
  type: RetrievalDocType;
  chapterNumber?: number;
  section?: string;
  text: string;
  score: number;
}

export interface RetrieveOptions {
  topK?: number;
  types?: RetrievalDocType[];
  chapterRange?: { start: number; end: number };
}
