import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownElements } from "./MarkdownElements";

export function MarkdownProse({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownElements}>
      {children}
    </ReactMarkdown>
  );
}
