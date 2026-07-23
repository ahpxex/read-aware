import { Link, createFileRoute } from "@tanstack/react-router";
import { formatPostDate, listPosts } from "../../../lib/posts";

export const Route = createFileRoute("/ja/blog/")({
  head: () => ({
    meta: [
      { title: "ブログ — ReadAware" },
      {
        name: "description",
        content:
          "ReadAwareをつくりながらのノート。読書、記憶、ローカルファーストなソフトウェア、そしてプラグインについて。",
      },
    ],
  }),
  component: BlogIndex,
});

function BlogIndex() {
  const posts = listPosts();

  return (
    <div>
      <h1 className="text-[clamp(1.75rem,3.6vw,2.2rem)] font-normal leading-[1.15] tracking-[-0.01em]">
        ブログ
      </h1>
      <p className="mt-4 text-[1.0625rem] leading-[1.75] text-fg-muted">
        ReadAwareをつくりながらのノート——読書のこと、記憶のこと、そして自分のものであり続けるソフトウェアのこと。
      </p>

      <ul className="mt-10">
        {posts.map((post, index) => (
          <li
            key={post.slug}
            className={index > 0 ? "border-t border-border py-7" : "pb-7"}
          >
            <time
              dateTime={post.date}
              className="text-[0.875rem] text-fg-subtle"
            >
              {formatPostDate(post.date, "ja")}
            </time>
            <h2 className="mt-1.5 text-[1.25rem] font-medium leading-[1.3] tracking-[-0.01em]">
              <Link
                to={`/ja/blog/${post.slug}`}
                className="transition-colors hover:text-fg-muted"
              >
                {post.text.ja.title}
              </Link>
            </h2>
            <p className="mt-2 text-[1.0625rem] leading-[1.7] text-fg-muted">
              {post.text.ja.description}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
