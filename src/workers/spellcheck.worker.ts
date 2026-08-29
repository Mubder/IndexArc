/**
 * Spellcheck off-main-thread — tokenization + filtering
 * Heavy Intl.Segmenter work moved from ScratchpadTab.tsx:195
 */
const CLEAN_TOKEN_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u0640\u064B-\u0652\u0670]/g;
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const LATIN_WORD_RE = /^[A-Za-z]+(?:['\u2019-][A-Za-z]+)*$/;

function sanitizeToken(token: string): string {
  return token.replace(CLEAN_TOKEN_RE, "");
}
function isArabicToken(token: string): boolean {
  return ARABIC_RE.test(token) && !/[A-Za-z]/.test(token);
}
function isLatinToken(token: string): boolean {
  return LATIN_WORD_RE.test(token);
}

function extractSpellWords(text: string): string[] {
  const words: string[] = [];
  try {
    const segmenter = new (Intl as any).Segmenter(["en", "ar"], { granularity: "word" });
    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike) continue;
      const clean = sanitizeToken(segment.segment);
      if (!clean || clean.length <= 1) continue;
      if (isArabicToken(clean) || isLatinToken(clean)) words.push(clean);
    }
  } catch {
    const SPELL_WORD_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+|[A-Za-z]+(?:['\u2019-][A-Za-z]+)*/g;
    const matches = text.match(SPELL_WORD_RE) || [];
    for (const m of matches) {
      const clean = sanitizeToken(m);
      if (!clean || clean.length <= 1) continue;
      if (isArabicToken(clean) || isLatinToken(clean)) words.push(clean);
    }
  }
  return Array.from(new Set(words));
}

self.onmessage = (e: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = e.data;
  const words = extractSpellWords(text);
  (self as any).postMessage({ id, words });
};
