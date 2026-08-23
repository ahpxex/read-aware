import { Link } from "@tanstack/react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

const components: Components = {
  a({ href = "", children }) {
    if (href.startsWith("/")) {
      return <Link to={href as never}>{children}</Link>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  code({ className, children }) {
    const code = String(children).replace(/\n$/, "");
    const language = className?.match(/language-([^\s]+)/)?.[1];
    if (language || code.includes("\n")) {
      return <CodeBlock code={code} language={language ?? "text"} />;
    }
    return <code className={className}>{children}</code>;
  },
  pre({ children }) {
    return <>{children}</>;
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    );
  },
};

export function MarkdownDoc({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
