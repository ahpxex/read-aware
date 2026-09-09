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

export function searchChapters(
  chapters: ChapterLike[],
  queries: string[],
  limit = 16,
): ChapterHit[] {
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
    chapters.forEach((chapter, chapterIndex) => {
      let from = 0;
      for (let n = 0; n < MAX_HITS_PER_CHAPTER_PER_QUERY; n++) {
        const at = chapter.text.indexOf(query, from);
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
    });
    if (queryHasExact) continue;

    // 2) 回退：词元 AND（≥4 个词元时放宽到过半）——按章判定，片段取首个词元附近
    const tokens = tokenize(query);
    if (tokens.length < 2) continue;
    const required = tokens.length >= 4 ? Math.ceil(tokens.length / 2) : tokens.length;
    chapters.forEach((chapter, chapterIndex) => {
      const present = tokens.filter((token) => chapter.text.includes(token));
      if (present.length < required) return;
      const at = chapter.text.indexOf(present[0]);
      push(partial, {
        chapterIndex,
        chapterTitle: chapter.title,
        snippet: snippetAround(chapter.text, at, present[0].length),
        offset: at,
        match: "partial",
      });
    });
  }

  return [...exact, ...partial].slice(0, limit);
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
