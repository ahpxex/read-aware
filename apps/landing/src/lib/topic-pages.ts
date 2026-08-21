/**
 * The registry of topic pages — standalone English pages, each answering one
 * real search intent ("open source ebook reader", "epub reader for windows").
 * The footer's quiet link row and each page's "More about ReadAware" strip
 * both render from this list, so adding a page here wires up its internal
 * links everywhere at once; the route file itself is picked up automatically
 * by the prerender pass and the sitemap (scripts/prerender.mjs).
 *
 * These are content pages, not doorways: each carries its own prose, the
 * download section, and an FAQ. English-only on purpose — the prerender's
 * hreflang pass skips pages without locale variants.
 *
 * THE RED LINE — read before adding an entry: only add a page when it can say
 * something no existing page could produce by find-and-replace. The Windows
 * page earns its slot with installer variants and the SmartScreen story, the
 * Android page with APK sideloading and sync pricing; a hypothetical
 * /epub-reader-for-macos or /mobi-reader would differ from its siblings only
 * in the keyword, and a handful of those turns this list into exactly the
 * doorway-page cluster search engines demote. Four hand-written pages is a
 * content strategy; forty templated ones is a penalty. When Search Console
 * reports these as "Crawled – not indexed", the answer is to deepen or merge
 * pages, never to add more.
 */
export type TopicPage = {
  /** Route path, no trailing slash ("/open-source-ebook-reader"). */
  path: string;
  /** Anchor text for internal links — phrased like the search, not the brand. */
  label: string;
};

export const TOPIC_PAGES: readonly TopicPage[] = [
  { path: "/open-source-ebook-reader", label: "Open-source ebook reader" },
  { path: "/epub-reader-for-windows", label: "EPUB reader for Windows" },
  { path: "/epub-reader-for-android", label: "EPUB reader for Android" },
  { path: "/cbz-cbr-reader", label: "CBZ & CBR comic reader" },
];
