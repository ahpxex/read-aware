import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { UI_STRINGS, type Locale } from "../lib/i18n";
import { formatPostDate, getPost } from "../lib/posts";

const INDEX_TO = { en: "/blog", zh: "/zh/blog", ja: "/ja/blog" } as const;

/**
 * The article frame every blog post renders inside: dateline, localized
 * title, prose body, and a way back to the index. Post metadata comes from
 * the registry in `lib/posts.ts`, so a post file only supplies its slug,
 * locale, and content.
 */
export function BlogPost({
  slug,
  locale = "en",
  children,
}: {
  slug: string;
  locale?: Locale;
  children: ReactNode;
}) {
  const post = getPost(slug);
  const text = post.text[locale];

  return (
    <article>
      <header>
        <time dateTime={post.date} className="text-[0.875rem] text-fg-subtle">
          {formatPostDate(post.date, locale)}
        </time>
        <h1 className="mt-2 text-[clamp(1.75rem,3.6vw,2.2rem)] font-normal leading-[1.15] tracking-[-0.01em]">
          {text.title}
        </h1>
      </header>
      <div className="doc-prose mt-8">{children}</div>
      <p className="mt-12 text-[0.9375rem]">
        <Link
          to={INDEX_TO[locale]}
          className="text-fg-muted underline underline-offset-4 transition-colors hover:text-fg"
        >
          {UI_STRINGS[locale].allPosts}
        </Link>
      </p>
    </article>
  );
}
