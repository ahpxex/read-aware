import { isValidElement, type ReactElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { markdownElements } from "./MarkdownElements";

const components: Components = {
  ...markdownElements,
  pre({ children }) {
    if (isValidElement(children)) {
      const codeElement = children as ReactElement<{
        children?: unknown;
        className?: string;
      }>;
      const language = codeElement.props.className?.match(/language-([^\s]+)/)?.[1];
      return (
        <CodeBlock
          code={String(codeElement.props.children ?? "").replace(/\n$/, "")}
          language={language ?? "text"}
        />
      );
    }
    return <CodeBlock code={String(children)} language="text" />;
  },
};

export function MarkdownDoc({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
