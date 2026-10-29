/**
 * In-reply fragment links: footnote citations (`[^1]`), their `↩` back-links,
 * and any `[label](#anchor)` a model writes. They point inside the same reply,
 * never at a page to open externally.
 *
 * remark-rehype writes `href="#user-content-fn-1"` beside
 * `id="user-content-fn-1"`; since Streamdown 2.6 its sanitize step no longer
 * clobber-prefixes ids a second time. Both sides keep the same
 * percent-encoding, so the target id is the fragment verbatim — no URI
 * decoding. Each reply restarts its footnote numbering, so ids repeat across a
 * transcript and resolution must stay inside one reply.
 */

/** Class on the root of one rendered reply; also the scope for fragment lookups. */
export const MARKDOWN_REPLY_CLASS = "ra-chat-markdown";

export function isFragmentHref(href: string): boolean {
  return href.length > 1 && href.startsWith("#");
}

/** The rendered element id a fragment href refers to. */
export function fragmentTargetId(href: string): string {
  return href.slice(1);
}
