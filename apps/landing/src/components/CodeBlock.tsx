import { Highlight, type PrismTheme } from "prism-react-renderer";

const syntaxTheme: PrismTheme = {
  plain: {
    color: "var(--color-fg)",
    backgroundColor: "transparent",
  },
  styles: [
    {
      types: ["comment", "prolog", "doctype", "cdata"],
      style: { color: "var(--syntax-comment)", fontStyle: "italic" },
    },
    {
      types: ["keyword", "operator", "important"],
      style: { color: "var(--syntax-keyword)" },
    },
    {
      types: ["string", "char", "attr-value", "template-string"],
      style: { color: "var(--syntax-string)" },
    },
    {
      types: ["number", "boolean", "constant", "symbol"],
      style: { color: "var(--syntax-number)" },
    },
    {
      types: ["function", "class-name", "builtin"],
      style: { color: "var(--syntax-function)" },
    },
    {
      types: ["property", "tag", "selector", "attr-name"],
      style: { color: "var(--syntax-property)" },
    },
    {
      types: ["punctuation"],
      style: { color: "var(--syntax-punctuation)" },
    },
  ],
};

export function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <Highlight theme={syntaxTheme} code={code.trimEnd()} language={language}>
      {({ className, tokens, getLineProps, getTokenProps }) => (
        <pre className={className}>
          <code>
            {tokens.map((line, lineIndex) => (
              <span key={lineIndex} {...getLineProps({ line })} className="block min-w-max">
                {line.map((token, tokenIndex) => (
                  <span key={tokenIndex} {...getTokenProps({ token })} />
                ))}
              </span>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}
