import { Streamdown, type PluginConfig } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { cn } from "@read-aware/ui/cn";
import { MARKDOWN_REPLY_CLASS, replyRehypePlugins } from "../lib/markdown-fragment";
import { MarkdownLink } from "./MarkdownLink";

const components = {
  a: MarkdownLink,
  img: ({ alt }: { alt?: string }) => (alt ? <span>{alt}</span> : null),
};
// CJK-aware parsing: a bare URL ends at full-width punctuation (`（官网：https://a.b/）`
// would otherwise link `https://a.b/）`), and emphasis works next to CJK text.
const plugins: PluginConfig = { cjk };

/**
 * Renders assistant replies as Markdown via Streamdown (handles partial/unclosed
 * Markdown mid-stream out of the box). Kept deliberately quiet for the reader's
 * editorial surface: no copy/download chrome, no code line numbers. Streamdown's
 * shadcn-style color utilities are remapped onto our palette in `index.css`, so
 * it inherits the paper theme and dark mode automatically.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown
      controls={false}
      lineNumbers={false}
      plugins={plugins}
      // Model-written HTML ids and names stay clobber-prefixed (markdown-fragment).
      rehypePlugins={replyRehypePlugins}
      // Links confirm before leaving the app and footnotes jump within the
      // reply (MarkdownLink). Retrieved images use source-backed reference
      // cards; prose must not invent remote image requests (even mid-stream).
      components={components}
      className={cn(MARKDOWN_REPLY_CLASS, className)}
    >
      {children}
    </Streamdown>
  );
}
