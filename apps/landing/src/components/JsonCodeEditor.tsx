import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

const editorTheme = EditorView.theme({
  "&": {
    border: "1px solid var(--color-border-strong)",
    backgroundColor: "var(--color-surface)",
    color: "var(--color-fg)",
    fontSize: "0.8125rem",
  },
  "&.cm-focused": {
    borderColor: "var(--color-fg-muted)",
    outline: "none",
  },
  ".cm-scroller": {
    minHeight: "30rem",
    fontFamily: "var(--font-mono)",
    lineHeight: "1.5rem",
  },
  ".cm-content": {
    padding: "0.75rem 0",
    caretColor: "var(--color-fg)",
  },
  ".cm-gutters": {
    borderRight: "1px solid var(--color-border)",
    backgroundColor: "var(--color-fill)",
    color: "var(--color-fg-subtle)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "var(--color-fill)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-fg)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
});

const jsonHighlighting = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--syntax-property)" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-number)" },
  { tag: tags.punctuation, color: "var(--syntax-punctuation)" },
  { tag: tags.invalid, color: "var(--syntax-keyword)", textDecoration: "underline" },
]);

const extensions = [json(), EditorView.lineWrapping, editorTheme, syntaxHighlighting(jsonHighlighting)];

export function JsonCodeEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const editorExtensions = useMemo(
    () => [...extensions, EditorView.contentAttributes.of({ "aria-label": label })],
    [label],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={editorExtensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        autocompletion: false,
      }}
      className="mt-3 min-w-0 overflow-hidden"
    />
  );
}
