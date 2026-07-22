import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { formatPostDate, getPost } from "../lib/posts";

/**
 * The article frame every blog post renders inside: dateline, title, prose
 * body, and a way back to the index. Post metadata comes from the registry in
 * `lib/posts.ts`, so a post file only supplies its slug and its content.
 */
export function BlogPost({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const post = getPost(slug);

  return (
    <article>
      <header>
        <time
          dateTime={post.date}
          className="text-[0.875rem] text-fg-subtle"
        >
          {formatPostDate(post.date)}
        </time>
        <h1 className="mt-2 text-[clamp(1.75rem,3.6vw,2.2rem)] font-normal leading-[1.15] tracking-[-0.01em]">
          {post.title}
        </h1>
      </header>
      <div className="doc-prose mt-8">{children}</div>
      <p className="mt-12 text-[0.9375rem]">
        <Link
          to="/blog"
          className="text-fg-muted underline underline-offset-4 transition-colors hover:text-fg"
        >
          ← All posts
        </Link>
      </p>
    </article>
  );
}
