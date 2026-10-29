import { defaultRehypePlugins } from "streamdown";

/**
 * In-reply fragment links: footnote citations (`[^1]`), their `↩` back-links,
 * and any `[label](#anchor)` a model writes. They point inside the same reply,
 * never at a page to open externally.
 *
 * Every rendered id and name is clobber-prefixed so model-written HTML
 * (`<a id="root">`, `<img name="config">`) cannot collide with app ids or
 * shadow `window`/`document` named properties. Streamdown 2.6+ ships its
 * sanitize schema with `clobberPrefix: ""`, so replies restore the prefix
 * (`replyRehypePlugins`). remark-rehype writes `href="#user-content-fn-1"`
 * and sanitize then prefixes the id once more (`id="user-content-user-content-fn-1"`).
 * Both sides keep the same percent-encoding, so the target id is the fragment
 * verbatim behind one more prefix — no URI decoding. Each reply restarts its
 * footnote numbering, so ids repeat across a transcript and resolution must
 * stay inside one reply.
 */

const SANITIZE_ID_PREFIX = "user-content-";

type RehypePlugin = (typeof defaultRehypePlugins)[string];

/** Streamdown's default rehype pipeline with id/name clobbering restored. */
export const replyRehypePlugins: RehypePlugin[] = Object.entries(defaultRehypePlugins).map(([name, plugin]) => {
  if (name !== "sanitize" || !Array.isArray(plugin)) return plugin;
  const [attacher, schema] = plugin;
  return [attacher, { ...(schema as object), clobberPrefix: SANITIZE_ID_PREFIX }] as RehypePlugin;
});

/** Class on the root of one rendered reply; also the scope for fragment lookups. */
export const MARKDOWN_REPLY_CLASS = "ra-chat-markdown";

export function isFragmentHref(href: string): boolean {
  return href.length > 1 && href.startsWith("#");
}

/** The rendered element id a fragment href refers to. */
export function fragmentTargetId(href: string): string {
  return SANITIZE_ID_PREFIX + href.slice(1);
}
