import { Link } from "@tanstack/react-router";
import { useSiteCopy } from "../i18n/use-site-copy";
import { localizePath, type BlogLocale } from "../lib/i18n";
import { formatPostDate } from "./BlogPost";

export function BlogIndexPage({ locale }: { locale: BlogLocale }) {
  const copy = useSiteCopy("blog");
  const posts = Object.entries(copy.posts).sort(([, a], [, b]) =>
    b.date.localeCompare(a.date),
  );

  return (
    <div>
      <h1 className="text-[clamp(1.75rem,3.6vw,2.2rem)] font-normal leading-[1.15] tracking-[-0.01em]">
        {copy.title}
      </h1>
      <p className="mt-4 text-[1.0625rem] leading-[1.75] text-fg-muted">
        {copy.lead}
      </p>

      <ul className="mt-10">
        {posts.map(([slug, post], index) => (
          <li
            key={slug}
            className={index > 0 ? "border-t border-border py-7" : "pb-7"}
          >
            <time dateTime={post.date} className="text-[0.875rem] text-fg-subtle">
              {formatPostDate(post.date, locale)}
            </time>
            <h2 className="mt-1.5 text-[1.25rem] font-medium leading-[1.3] tracking-[-0.01em]">
              <Link
                to={localizePath(`/blog/${slug}`, locale) as never}
                className="transition-colors hover:text-fg-muted"
              >
                {post.title}
              </Link>
            </h2>
            <p className="mt-2 text-[1.0625rem] leading-[1.7] text-fg-muted">
              {post.description}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
