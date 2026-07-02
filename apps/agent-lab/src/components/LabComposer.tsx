/** lab 的输入框：Enter 发送、Shift+Enter 换行、流式中可停止、可携带阅读选区。 */
import { useState, type KeyboardEvent } from "react";
import { ArrowUp, Quotes, Stop, X } from "@phosphor-icons/react";
import { Caption, IconButton } from "@read-aware/ui";
import type { ReaderQuote } from "./LabReader";

type LabComposerProps = {
  isStreaming: boolean;
  pendingQuote: ReaderQuote | null;
  onRemoveQuote: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
};

export function LabComposer({
  isStreaming,
  pendingQuote,
  onRemoveQuote,
  onSend,
  onStop,
}: LabComposerProps) {
  const [text, setText] = useState("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {pendingQuote && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-paper-warm/50 px-2.5 py-2">
          <Quotes size={13} weight="fill" className="mt-0.5 shrink-0 text-fg-subtle" />
          <Caption className="line-clamp-2 flex-1 text-fg-muted">
            {pendingQuote.text}
            {pendingQuote.chapter ? `（${pendingQuote.chapter}）` : ""}
          </Caption>
          <IconButton
            label="移除引用"
            size="sm"
            onClick={onRemoveQuote}
            icon={<X size={12} />}
            className="shrink-0"
          />
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          rows={2}
          placeholder="问点什么…（Enter 发送）"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-0 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-fg-subtle focus:border-border-strong"
        />
        {isStreaming ? (
          <IconButton label="停止" onClick={onStop} icon={<Stop size={16} weight="fill" />} />
        ) : (
          <IconButton
            label="发送"
            onClick={submit}
            disabled={!text.trim()}
            icon={<ArrowUp size={16} weight="bold" />}
          />
        )}
      </div>
    </div>
  );
}
