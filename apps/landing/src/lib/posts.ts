import type { Locale } from "./i18n";

/**
 * The blog's post registry. Each post is one route file per locale —
 * `src/routes/blog/<slug>.tsx` (English), `src/routes/zh/blog/<slug>.tsx`,
 * `src/routes/ja/blog/<slug>.tsx` — wrapped in `<BlogPost slug locale>`. This
 * list is the single source of every post's date and localized title and
 * description, used by the index pages, the post headers, and meta tags.
 * Publishing a post means adding its route files and one entry here;
 * translated route files must use the exact titles registered below.
 */
export type PostText = { title: string; description: string };

export type PostMeta = {
  /** Route path segment; must match the route file names in every locale. */
  slug: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  text: Record<Locale, PostText>;
};

export const POSTS = [
  {
    slug: "plugins-v1",
    date: "2026-07-22",
    text: {
      en: {
        title: "Plugins: the reader, extended",
        description:
          "ReadAware now has a plugin system and a community marketplace. Selection actions, native-looking pages, agent tools, and books that aren't files.",
      },
      zh: {
        title: "插件：阅读器的延伸",
        description:
          "ReadAware 现已支持插件系统和社区市场。选区动作、原生观感的页面、agent 工具，以及“不是文件的书”。",
      },
      ja: {
        title: "プラグイン：リーダーを拡張する",
        description:
          "ReadAwareにプラグインシステムとコミュニティマーケットプレイスが登場。選択テキストアクション、ネイティブに見えるページ、エージェントツール、そして「ファイルではない本」。",
      },
    },
  },
  {
    slug: "local-first",
    date: "2026-07-14",
    text: {
      en: {
        title: "Your library is not a cloud feature",
        description:
          "Why ReadAware keeps your books, annotations, and memory on your device, and what the network is actually for.",
      },
      zh: {
        title: "你的书库不是一项云功能",
        description:
          "为什么 ReadAware 把书籍、批注和记忆放在你的设备上，以及网络到底用来做什么。",
      },
      ja: {
        title: "あなたのライブラリはクラウド機能ではない",
        description:
          "ReadAwareが本・注釈・記憶をあなたのデバイスに置く理由と、ネットワークの本当の役割。",
      },
    },
  },
  {
    slug: "reading-that-remembers",
    date: "2026-07-08",
    text: {
      en: {
        title: "Reading that remembers",
        description:
          "ReadAware 0.1 is out. Why we built another reading app: highlights that go somewhere, and an assistant with a memory.",
      },
      zh: {
        title: "记得住的阅读",
        description:
          "ReadAware 0.1 发布。我们为什么要再做一个阅读应用：让划线有去处，让助手有记忆。",
      },
      ja: {
        title: "記憶する読書",
        description:
          "ReadAware 0.1 リリース。なぜもう一つの読書アプリを作ったのか。ハイライトに行き先を、アシスタントに記憶を。",
      },
    },
  },
  // `as const satisfies` keeps each slug a literal type, so the index pages'
  // `<Link to={`/blog/${post.slug}`}>` (and locale-prefixed variants)
  // type-check against the route tree.
] as const satisfies readonly PostMeta[];

export type Post = (typeof POSTS)[number];

/** Posts newest-first for the index pages. */
export function listPosts(): Post[] {
  return [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}

export function getPost(slug: string): Post {
  const post = POSTS.find((entry) => entry.slug === slug);
  if (!post) throw new Error(`Unknown blog post: ${slug}`);
  return post;
}

const DATE_LOCALE: Record<Locale, string> = {
  en: "en-US",
  zh: "zh-CN",
  ja: "ja-JP",
};

/** "2026-07-22" → "July 22, 2026" / "2026年7月22日", stable per locale. */
export function formatPostDate(isoDate: string, locale: Locale = "en"): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    DATE_LOCALE[locale],
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
  );
}
