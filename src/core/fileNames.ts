const PINYIN_FALLBACK: Record<string, string> = {
  星: 'xing',
  火: 'huo',
  长: 'chang',
  夜: 'ye',
};

export function makeProjectSlug(title: string): string {
  const replaced = title
    .trim()
    .split('')
    .map((char) => PINYIN_FALLBACK[char] || char)
    .join('-')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return replaced || `novel-${Date.now()}`;
}

export function padChapterNumber(chapterNumber: number): string {
  if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
    throw new Error(`Invalid chapter number: ${chapterNumber}`);
  }
  return String(chapterNumber).padStart(3, '0');
}

export function chapterFileName(chapterNumber: number): string {
  return `${padChapterNumber(chapterNumber)}.md`;
}

export function memoryFileName(chapterNumber: number): string {
  return `chapter-${padChapterNumber(chapterNumber)}.json`;
}
