import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouterState } from "@tanstack/react-router";
import { localizePath, localeFromPathname, servedHref } from "../lib/i18n";
import { headingId } from "../lib/doc-headings";
import { CodeBlock } from "./CodeBlock";
import { markdownElements } from "./MarkdownElements";

function plainText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? plainText(child.props.children)
        : typeof child === "string" || typeof child === "number"
          ? String(child)
          : "",
    )
    .join("");
}
function DocLink({ href = "", children }: { href?: string; children?: ReactNode }) {
  const locale = useRouterState({
    select: (state) => localeFromPathname(state.location.pathname),
  });
  if (href.startsWith("/") && !href.startsWith("//"))
    return <a href={servedHref(localizePath(href, locale))}>{children}</a>;
  if (href.startsWith("#")) return <a href={href}>{children}</a>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
const components: Components = {
  ...markdownElements,
  a: DocLink,
  h2: ({ children }) => <h2 id={headingId(plainText(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={headingId(plainText(children))}>{children}</h3>,
  pre({ children }) {
    if (isValidElement(children)) {
      const codeElement = children as ReactElement<{
        children?: ReactNode;
        className?: string;
      }>;
      const language = codeElement.props.className?.match(/language-([^\s]+)/)?.[1];
      return (
        <CodeBlock code={plainText(codeElement.props.children).replace(/\n$/, "")} language={language ?? "text"} />
      );
    }
    return <CodeBlock code={plainText(children)} language="text" />;
  },
};

export function MarkdownDoc({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
