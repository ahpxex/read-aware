/**
 * 章节全文检索的共享实现（BookTextPort 的现状后端；目标态被 SQLite FTS 替换）。
 * 设计目标是"减少模型的检索往返"而不是搜索引擎级排序：
 *   1. 一次接收多个查询变体，合并去重；
 *   2. 精确子串之外有词元级回退（CJK 长短语换个说法就 miss 的主因），
 *      模型不必自己换词重试；
 *   3. 命中带章内偏移，工具层可换算成 read_chapter 的分片号直接跳读。
 */

export interface ChapterLike {
  title?: string;
  text: string;
}

export interface ChapterHit {
  chapterIndex: number;
  chapterTitle?: string;
  snippet: string;
  offset: number;
  match: "exact" | "partial";
}

const SNIPPET_RADIUS = 160;
const MAX_HITS_PER_CHAPTER_PER_QUERY = 3;
const DEDUPE_BUCKET_CHARS = 200;

/** 词元化：按标点/空白切，丢弃单字符碎片。CJK 不分词 —— 靠标点边界就够用。 */
function tokenize(query: string): string[] {
  return query
    .split(/[\s,.。，！？!?；;：:、"'“”‘’()（）《》〈〉【】\[\]\-—…·]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function snippetAround(text: string, offset: number, matchLength: number): string {
  const start = Math.max(0, offset - SNIPPET_RADIUS);
  const end = Math.min(text.length, offset + matchLength + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function* findTextSteps(text: string, query: string, from = 0): Generator<undefined, number, unknown> {
  const chunkSize = 32768;
  while (from <= text.length - query.length) {
    yield undefined;
    const end = Math.min(from + chunkSize, text.length - query.length + 1);
    const at = text.slice(from, end + query.length - 1).indexOf(query);
    if (at !== -1) return from + at;
    from = end;
  }
  return -1;
}

function* searchChapterSteps(
  chapters: ChapterLike[],
  queries: string[],
  limit = 16,
): Generator<undefined, ChapterHit[], unknown> {
  const cleanQueries = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  if (!cleanQueries.length) return [];

  const exact: ChapterHit[] = [];
  const partial: ChapterHit[] = [];
  const seen = new Set<string>();
  const push = (list: ChapterHit[], hit: ChapterHit) => {
    const key = `${hit.chapterIndex}:${Math.floor(hit.offset / DEDUPE_BUCKET_CHARS)}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(hit);
  };

  for (const query of cleanQueries) {
    let queryHasExact = false;

    // 1) 精确子串：每章最多取前几处
    for (const [chapterIndex, chapter] of chapters.entries()) {
      yield undefined;
      let from = 0;
      for (let n = 0; n < MAX_HITS_PER_CHAPTER_PER_QUERY; n++) {
        const at = yield* findTextSteps(chapter.text, query, from);
        if (at === -1) break;
        queryHasExact = true;
        push(exact, {
          chapterIndex,
          chapterTitle: chapter.title,
          snippet: snippetAround(chapter.text, at, query.length),
          offset: at,
          match: "exact",
        });
        from = at + query.length;
      }
    }
    if (queryHasExact) continue;

    // 2) 回退：词元 AND（≥4 个词元时放宽到过半）——按章判定，片段取首个词元附近
    const tokens = tokenize(query);
    if (tokens.length < 2) continue;
    const required = tokens.length >= 4 ? Math.ceil(tokens.length / 2) : tokens.length;
    for (const [chapterIndex, chapter] of chapters.entries()) {
      yield undefined;
      const present: Array<{ token: string; at: number }> = [];
      for (const token of tokens) {
        const at = yield* findTextSteps(chapter.text, token);
        if (at !== -1) present.push({ token, at });
      }
      if (present.length < required) continue;
      const { at, token } = present[0];
      push(partial, {
        chapterIndex,
        chapterTitle: chapter.title,
        snippet: snippetAround(chapter.text, at, token.length),
        offset: at,
        match: "partial",
      });
    }
  }

  return [...exact, ...partial].slice(0, limit);
}

export function searchChapters(chapters: ChapterLike[], queries: string[], limit = 16): ChapterHit[] {
  const steps = searchChapterSteps(chapters, queries, limit);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Same matching and ranking as the synchronous API, with cooperative cancellation. */
export async function searchChaptersAsync(chapters: ChapterLike[], queries: string[], limit = 16, signal?: AbortSignal): Promise<ChapterHit[]> {
  signal?.throwIfAborted();
  let deadline = performance.now() + 8;
  const steps = searchChapterSteps(chapters, queries, limit);
  let step = steps.next();
  while (!step.done) {
    signal?.throwIfAborted();
    if (performance.now() >= deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      deadline = performance.now() + 8;
    }
    step = steps.next();
  }
  signal?.throwIfAborted();
  return step.value;
}

export interface TurnLike {
  content: string;
  attachments?: Array<{ text: string }>;
}

/**
 * 历史对话原话检索的共享匹配（ConversationPort.searchTurns 的实现核心）。
 * 与 searchChapters 同一套哲学：多查询变体合并、精确子串优先、词元 AND
 * 回退（"你上次怎么说伊万的动机来着"这种口语查询逐字永远 miss——词元
 * 回退才是可用性的下限）。eval 的内存端口与产品端口都必须走这一个实现，
 * 匹配语义在接缝两侧不许漂移。
 */
export function searchTurnRecords<T extends TurnLike>(
  turns: T[],
  queries: string[],
  limit = 10,
): Array<T & { match: "exact" | "partial" }> {
  const cleanQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
  if (!cleanQueries.length) return [];
  const haystack = (turn: TurnLike) =>
    [turn.content, ...(turn.attachments?.map((attachment) => attachment.text) ?? [])].join("\n");

  const exact: Array<T & { match: "exact" | "partial" }> = [];
  const partial: Array<T & { match: "exact" | "partial" }> = [];
  const seen = new Set<T>();
  for (const query of cleanQueries) {
    let queryHasExact = false;
    for (const turn of turns) {
      if (seen.has(turn)) continue;
      if (haystack(turn).includes(query)) {
        queryHasExact = true;
        seen.add(turn);
        exact.push({ ...turn, match: "exact" });
      }
    }
    if (queryHasExact) continue;
    const tokens = tokenize(query);
    if (tokens.length < 2) continue;
    const required = tokens.length >= 4 ? Math.ceil(tokens.length / 2) : tokens.length;
    for (const turn of turns) {
      if (seen.has(turn)) continue;
      const text = haystack(turn);
      const present = tokens.filter((token) => text.includes(token));
      if (present.length < required) continue;
      seen.add(turn);
      partial.push({ ...turn, match: "partial" });
    }
  }
  return [...exact, ...partial].slice(0, limit);
}
