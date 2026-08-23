import bash from "@shikijs/langs/bash";
import json from "@shikijs/langs/json";
import typescript from "@shikijs/langs/typescript";
import githubDark from "@shikijs/themes/github-dark-default";
import githubLight from "@shikijs/themes/github-light-default";
import { Check, Copy } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useTranslation } from "react-i18next";
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { LanguageRegistration } from "shiki/types";

const fileTreeLanguage = {
  name: "tree",
  scopeName: "source.readaware-tree",
  repository: {},
  patterns: [
    { match: "#.*$", name: "comment.line.number-sign.readaware-tree" },
    { match: "(?:[\\w.-]+/)+", name: "entity.name.namespace.readaware-tree" },
    {
      match: "[\\w*.-]+\\.[A-Za-z0-9*.-]+",
      name: "string.unquoted.filename.readaware-tree",
    },
  ],
} satisfies LanguageRegistration;

const highlighter = createHighlighterCoreSync({
  themes: [githubLight, githubDark],
  langs: [bash, fileTreeLanguage, json, typescript],
  engine: createJavaScriptRegexEngine(),
  langAlias: {
    js: "typescript",
    javascript: "typescript",
    sh: "bash",
    shell: "bash",
    ts: "typescript",
  },
});

const SUPPORTED_LANGUAGES = new Set([
  "bash",
  "json",
  "typescript",
  "javascript",
  "js",
  "sh",
  "shell",
  "ts",
  "text",
  "tree",
  "plaintext",
  "txt",
]);

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!SUPPORTED_LANGUAGES.has(normalized)) return "text";
  if (["plaintext", "txt"].includes(normalized)) return "text";
  return normalized;
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useTranslation("site");
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);
  const normalizedLanguage = normalizeLanguage(language);
  const highlightedCode = useMemo(
    () =>
      toJsxRuntime(
        highlighter.codeToHast(code.trimEnd(), {
          lang: normalizedLanguage,
          themes: {
            light: "github-light-default",
            dark: "github-dark-default",
          },
        }),
        { Fragment, jsx, jsxs },
      ),
    [code, normalizedLanguage],
  );

  useEffect(
    () => () => {
      window.clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code.trimEnd());
      setCopied(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const copyLabel = copied ? t("code.copied") : t("code.copy");

  return (
    <figure className="code-block">
      <figcaption className="code-block-toolbar">
        <span className="code-block-language">{normalizedLanguage}</span>
        <IconButton
          size="sm"
          label={copyLabel}
          title={copyLabel}
          onClick={copyCode}
          icon={
            copied ? (
              <Check aria-hidden="true" size={15} />
            ) : (
              <Copy aria-hidden="true" size={15} />
            )
          }
          className="text-fg-subtle hover:text-fg"
        />
      </figcaption>
      {highlightedCode}
    </figure>
  );
}
