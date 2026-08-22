import DOMPurify from "dompurify";
import { marked } from "marked";
import { useState } from "react";

interface TranscriptTurn {
  question: string;
  answer: string;
  selection?: string;
  cursor?: {
    chapterIndex?: number;
    chapterTitle?: string;
    bookProgress?: number;
  };
  tools?: Array<{ name: string; args?: unknown; output?: string; isError?: boolean }>;
}

function Answer({ value }: { value: string }) {
  return (
    <div
      className="markdown-body max-w-[920px] text-sm leading-7"
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(marked.parse(value || "_没有返回回答_", { async: false })),
      }}
    />
  );
}

function ToolTrace({ tools }: { tools: NonNullable<TranscriptTurn["tools"]> }) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;
  return (
    <details
      className="mt-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-[11px] text-[var(--subtle)]">
        工具轨迹 · {tools.length}
      </summary>
      {open && (
        <div className="mt-2 grid gap-1">
          {tools.map((tool, index) => (
            <details
              key={`${tool.name}-${index}`}
              className={`border-l-2 pl-2.5 ${
                tool.isError ? "border-[var(--fail)]" : "border-[var(--border)]"
              }`}
            >
              <summary className="flex cursor-pointer items-center gap-2 text-xs">
                <code>{tool.name}</code>
                {tool.isError && (
                  <span className="rounded-[4px] bg-[var(--fail-bg)] px-1.5 text-[10px] text-[var(--fail)]">
                    错误
                  </span>
                )}
              </summary>
              {tool.args !== undefined && (
                <pre className="mt-1 max-h-72 overflow-auto">
                  {JSON.stringify(tool.args, null, 2)}
                </pre>
              )}
              {tool.output && <pre className="mt-1 max-h-72 overflow-auto">{tool.output}</pre>}
            </details>
          ))}
        </div>
      )}
    </details>
  );
}

export function TranscriptView({
  turns,
  activeIndex,
}: {
  turns: TranscriptTurn[];
  activeIndex?: number;
}) {
  return (
    <div>
      {turns.map((turn, index) => (
        <section
          className={`border-t border-[var(--border)] py-3 first:border-t-0 ${
            activeIndex === index ? "border-l-[3px] border-l-[var(--accent)] pl-3.5" : ""
          }`}
          aria-current={activeIndex === index ? "true" : undefined}
          key={index}
        >
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">
            <span>读者</span>
            <span className="font-normal text-[var(--subtle)]">第 {index + 1} 轮</span>
            {turn.cursor?.chapterTitle && (
              <span className="ml-auto max-w-[60%] truncate font-normal normal-case tracking-normal text-[var(--subtle)] max-sm:max-w-[48%]">
                {turn.cursor.chapterTitle}
                {turn.cursor.bookProgress !== undefined
                  ? ` · ${Math.round(turn.cursor.bookProgress * 100)}%`
                  : ""}
              </span>
            )}
          </div>
          <div className="whitespace-pre-wrap border-l-[3px] border-[var(--accent)] py-1.5 pl-3.5 text-[15px] font-medium">
            {turn.question}
          </div>
          {turn.selection && (
            <blockquote className="mt-2 ml-4 border-l-2 border-[var(--border)] pl-3 text-xs text-[var(--muted)]">
              {turn.selection}
            </blockquote>
          )}
          <div className="mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">
            Agent
          </div>
          <Answer value={turn.answer} />
          <ToolTrace tools={turn.tools ?? []} />
        </section>
      ))}
    </div>
  );
}
