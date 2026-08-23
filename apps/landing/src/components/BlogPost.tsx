import { Link } from "@tanstack/react-router";
import type { BlogPostSlug } from "../i18n";
import { useSiteCopy } from "../i18n/use-site-copy";
import { localizePath, type BlogLocale } from "../lib/i18n";
import { MarkdownDoc } from "./MarkdownDoc";

const DATE_LOCALE: Record<BlogLocale, string> = {
  en: "en-US",
  zh: "zh-CN",
  ja: "ja-JP",
};

export function formatPostDate(isoDate: string, locale: BlogLocale): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    DATE_LOCALE[locale],
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
  );
}

/**
 * Shared article frame for every blog URL. The route supplies only a slug and
 * locale; title, metadata, and Markdown body come from the i18next resource.
 */
export function BlogPost({
  slug,
  locale = "en",
}: {
  slug: BlogPostSlug;
  locale?: BlogLocale;
}) {
  const copy = useSiteCopy("blog");
  const post = copy.posts[slug];

  return (
    <article>
      <header>
        <time dateTime={post.date} className="text-[0.875rem] text-fg-subtle">
          {formatPostDate(post.date, locale)}
        </time>
        <h1 className="mt-2 text-[clamp(1.75rem,3.6vw,2.2rem)] font-normal leading-[1.15] tracking-[-0.01em]">
          {post.title}
        </h1>
      </header>
      <div className="doc-prose mt-8">
        <MarkdownDoc>{post.body}</MarkdownDoc>
      </div>
      <p className="mt-12 text-[0.9375rem]">
        <Link
          to={localizePath("/blog", locale) as never}
          className="text-fg-muted underline underline-offset-4 transition-colors hover:text-fg"
        >
          {copy.allPosts}
        </Link>
      </p>
    </article>
  );
}
