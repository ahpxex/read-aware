/**
 * 阅读位置 href → 抽取章节的反查。href 语义与 apps/web reader 的
 * epub-utils 保持一致（去 fragment、decodeURI、去 ../ 与前导 /），
 * 后缀匹配要求落在路径边界上（"text/ch1.html" ↔ "ch1.html" 匹配，
 * "part0010.html" ↔ "0.html" 不匹配）。
 */
import type { ChapterRef } from "../ports";

function canonicalHref(href: string): string {
  const bare = href.split("#")[0];
  let decoded = bare;
  try {
    decoded = decodeURI(bare);
  } catch {
    // 非法转义序列 —— 保留原样参与比较
  }
  return decoded.replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");
}

export function hrefMatches(left: string, right: string): boolean {
  const a = canonicalHref(left);
  const b = canonicalHref(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** 在 getToc 返回的章节表里找覆盖了给定 href 的那一章。 */
export function findChapterByHref(
  toc: ChapterRef[],
  href: string,
): ChapterRef | undefined {
  return toc.find((chapter) =>
    chapter.hrefs?.some((candidate) => hrefMatches(candidate, href)),
  );
}
