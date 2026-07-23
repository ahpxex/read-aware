import { Link, createFileRoute } from "@tanstack/react-router";
import { formatPostDate, listPosts } from "../../../lib/posts";

export const Route = createFileRoute("/zh/blog/")({
  head: () => ({
    meta: [
      { title: "博客 — ReadAware" },
      {
        name: "description",
        content:
          "构建 ReadAware 过程中的记录：阅读、记忆、本地优先的软件，以及插件。",
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
        博客
      </h1>
      <p className="mt-4 text-[1.0625rem] leading-[1.75] text-fg-muted">
        构建 ReadAware 过程中的记录——关于阅读、记忆，以及始终属于你的软件。
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
              {formatPostDate(post.date, "zh")}
            </time>
            <h2 className="mt-1.5 text-[1.25rem] font-medium leading-[1.3] tracking-[-0.01em]">
              <Link
                to={`/zh/blog/${post.slug}`}
                className="transition-colors hover:text-fg-muted"
              >
                {post.text.zh.title}
              </Link>
            </h2>
            <p className="mt-2 text-[1.0625rem] leading-[1.7] text-fg-muted">
              {post.text.zh.description}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
