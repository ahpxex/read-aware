/** lab 自己的极简转录视图：用户气泡 + streamdown 渲染的助手回复 + 流式块。 */
import { useEffect, useRef } from "react";
import { Caption } from "@read-aware/ui";
import { Streamdown } from "streamdown";
import type { LabMessage } from "../useAgentLab";

type LabTranscriptProps = {
  messages: LabMessage[];
  isStreaming: boolean;
  streamingText: string;
  status: string | null;
};

export function LabTranscript({ messages, isStreaming, streamingText, status }: LabTranscriptProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streamingText]);

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      {messages.length === 0 && !isStreaming && (
        <div className="flex h-full items-center justify-center">
          <Caption className="text-fg-subtle">向 agent 提问，右栏观察它的内部状态。</Caption>
        </div>
      )}
      <div className="flex flex-col gap-4">
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="ml-12 self-end rounded-lg bg-fill px-3 py-2 text-sm">
              {message.content}
            </div>
          ) : (
            <div key={message.id} className="mr-4 text-sm">
              <Streamdown controls={false} lineNumbers={false}>
                {message.content}
              </Streamdown>
            </div>
          ),
        )}
        {isStreaming && (
          <div className="mr-4 text-sm">
            {streamingText ? (
              <Streamdown controls={false} lineNumbers={false}>
                {streamingText}
              </Streamdown>
            ) : (
              <Caption className="text-fg-subtle">{status ?? "thinking"}…</Caption>
            )}
          </div>
        )}
      </div>
      <div ref={endRef} />
    </div>
  );
}
