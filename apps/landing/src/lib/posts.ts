/**
 * The blog's post registry. Each post is a route file under
 * `src/routes/blog/<slug>.tsx` wrapped in `<BlogPost slug="…">`; this list is
 * the single source of its title, date, and description — used by the index
 * page, the post header, and the post's meta tags. Publishing a post means
 * adding its route file and one entry here.
 */
export type PostMeta = {
  /** Route path segment; must match the route file name. */
  slug: string;
  title: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  description: string;
};

export const POSTS = [
  {
    slug: "plugins-v1",
    title: "Plugins: the reader, extended",
    date: "2026-07-22",
    description:
      "ReadAware now has a plugin system and a community marketplace. Selection actions, native-looking pages, agent tools, and books that aren't files.",
  },
  {
    slug: "local-first",
    title: "Your library is not a cloud feature",
    date: "2026-07-14",
    description:
      "Why ReadAware keeps your books, annotations, and memory on your device, and what the network is actually for.",
  },
  {
    slug: "reading-that-remembers",
    title: "Reading that remembers",
    date: "2026-07-08",
    description:
      "ReadAware 0.1 is out. Why we built another reading app: highlights that go somewhere, and an assistant with a memory.",
  },
  // `as const satisfies` keeps each slug a literal type, so the index page's
  // `<Link to={`/blog/${post.slug}`}>` type-checks against the route tree.
] as const satisfies readonly PostMeta[];

export type Post = (typeof POSTS)[number];

/** Posts newest-first for the index page. */
export function listPosts(): Post[] {
  return [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}

export function getPost(slug: string): PostMeta {
  const post = POSTS.find((entry) => entry.slug === slug);
  if (!post) throw new Error(`Unknown blog post: ${slug}`);
  return post;
}

/** "2026-07-22" → "July 22, 2026", rendered stably regardless of locale. */
export function formatPostDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
