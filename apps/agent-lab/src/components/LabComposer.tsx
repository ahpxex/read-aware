/** lab 自己的极简输入框：Enter 发送、Shift+Enter 换行、流式中可停止。 */
import { useState, type KeyboardEvent } from "react";
import { ArrowUp, Stop } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";

type LabComposerProps = {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
};

export function LabComposer({ isStreaming, onSend, onStop }: LabComposerProps) {
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
  );
}
