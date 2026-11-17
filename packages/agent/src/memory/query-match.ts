/**
 * Memory retrieval's query match, mirroring the store's FTS rule (Rust:
 * `schema::memory_match_expr` over `ra_fts_segment`) for the in-memory ports
 * that the fixtures and the headless eval host use. Text is segmented the same
 * way: CJK runs become overlapping bigrams, other letter/number runs stay
 * whole words, folded for case and diacritics. A memory matches when it holds
 * every query term (words by prefix, CJK runs as bigram phrases), or any one
 * distinctive term (a word of 4+ characters, a CJK run of 2+).
 * `memory-query-cases.json` pins both sides to the same results.
 */
const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿㇰ-ㇿ가-힯ᄀ-ᇿ\u{20000}-\u{2FA1F}]/u;
const ALPHANUMERIC = /[\p{Alphabetic}\p{N}]/u;

const fold = (token: string) => token.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Part = { tokens: string[]; prefix: boolean; distinctive: boolean };

function segment(text: string, emitWord: (word: string) => void, emitRun: (run: string[]) => void): void {
  let word = "";
  let run: string[] = [];
  const flushWord = () => {
    if (word) emitWord(word);
    word = "";
  };
  const flushRun = () => {
    if (run.length) emitRun(run);
    run = [];
  };
  for (const char of text) {
    if (CJK.test(char)) {
      flushWord();
      run.push(char);
    } else if (ALPHANUMERIC.test(char)) {
      flushRun();
      word += char;
    } else {
      flushWord();
      flushRun();
    }
  }
  flushWord();
  flushRun();
}

const bigrams = (run: string[]) =>
  run.length === 1 ? run : run.slice(0, -1).map((char, index) => char + run[index + 1]);

function tokens(text: string): string[] {
  const out: string[] = [];
  segment(
    text,
    (word) => out.push(fold(word)),
    (run) => out.push(...bigrams(run).map(fold)),
  );
  return out;
}

function parts(query: string): Part[] {
  const out: Part[] = [];
  segment(
    query,
    (word) => out.push({ tokens: [fold(word)], prefix: true, distinctive: [...word].length >= 4 }),
    (run) =>
      out.push(
        run.length === 1
          ? { tokens: [fold(run[0]!)], prefix: true, distinctive: false }
          : { tokens: bigrams(run).map(fold), prefix: false, distinctive: true },
      ),
  );
  return out;
}

function holds(content: string[], part: Part): boolean {
  if (part.prefix) return content.some((token) => token.startsWith(part.tokens[0]!));
  return content.some((_, start) => part.tokens.every((token, offset) => content[start + offset] === token));
}

/** Whether `content` matches the retrieval `query`; an empty query matches all. */
export function matchesMemoryQuery(content: string, query: string): boolean {
  if (!query.trim()) return true;
  const terms = parts(query);
  if (!terms.length) return false;
  const words = tokens(content);
  return terms.every((part) => holds(words, part)) || terms.some((part) => part.distinctive && holds(words, part));
}
