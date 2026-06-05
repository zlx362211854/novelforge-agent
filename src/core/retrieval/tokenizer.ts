const CJK_RANGE = /[㐀-鿿]/;
const ALNUM_RANGE = /[a-z0-9]/;

export function isCjk(char: string): boolean {
  return CJK_RANGE.test(char);
}

// Pragmatic tokenizer for mixed Chinese + Latin text without jieba:
// - Latin / digit runs are lowercased and emitted whole.
// - CJK characters are emitted as both unigrams and overlapping bigrams.
//   "陈青云走" -> ["陈", "陈青", "青", "青云", "云", "云走", "走"]
// - Everything else acts as a separator.
//
// Unigrams cover names and recall; bigrams give phrase locality so a search for
// "陈青云" prefers chapters that actually contain that phrase.
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lowered = text.toLowerCase();
  let alnumBuf = '';
  const flushAlnum = () => {
    if (alnumBuf) {
      tokens.push(alnumBuf);
      alnumBuf = '';
    }
  };

  for (let i = 0; i < lowered.length; i += 1) {
    const c = lowered[i];
    if (isCjk(c)) {
      flushAlnum();
      tokens.push(c);
      const next = lowered[i + 1];
      if (next && isCjk(next)) {
        tokens.push(c + next);
      }
    } else if (ALNUM_RANGE.test(c)) {
      alnumBuf += c;
    } else {
      flushAlnum();
    }
  }
  flushAlnum();
  return tokens;
}
