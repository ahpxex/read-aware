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
      className="transcript-answer md"
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
      className="trace-block"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>工具轨迹 · {tools.length}</summary>
      {open && (
        <div className="trace-list">
          {tools.map((tool, index) => (
            <details key={`${tool.name}-${index}`} className={`tool ${tool.isError ? "fail" : ""}`}>
              <summary>
                <code>{tool.name}</code>
                {tool.isError && <span className="badge fail">错误</span>}
              </summary>
              {tool.args !== undefined && <pre>{JSON.stringify(tool.args, null, 2)}</pre>}
              {tool.output && <pre>{tool.output}</pre>}
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
    <div className="transcript">
      {turns.map((turn, index) => (
        <section
          className={`transcript-turn${activeIndex === index ? " active" : ""}`}
          aria-current={activeIndex === index ? "true" : undefined}
          key={index}
        >
          <div className="message-head">
            <span>读者</span>
            <span className="turn-index">第 {index + 1} 轮</span>
            {turn.cursor?.chapterTitle && (
              <span className="context-chip">
                {turn.cursor.chapterTitle}
                {turn.cursor.bookProgress !== undefined
                  ? ` · ${Math.round(turn.cursor.bookProgress * 100)}%`
                  : ""}
              </span>
            )}
          </div>
          <div className="transcript-question">{turn.question}</div>
          {turn.selection && <blockquote className="selection-quote">{turn.selection}</blockquote>}
          <div className="message-head agent-head">Agent</div>
          <Answer value={turn.answer} />
          <ToolTrace tools={turn.tools ?? []} />
        </section>
      ))}
    </div>
  );
}
