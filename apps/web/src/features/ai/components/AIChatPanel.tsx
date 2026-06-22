import { useState, useRef, useEffect, useCallback } from "react";
import { Button, TextArea, Body, Heading, IconButton, Alert, Spinner } from "@read-aware/ui";
import { X, PaperPlaneRight, Stop } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import type { AIChat, AIChatMessage } from "../../annotations/lib/annotation-types";
import { sendChatCompletionStreaming } from "../lib/ai-service";
import type { ChatMessage } from "../lib/ai-service";

export interface AIChatPanelProps {
  isOpen: boolean;
  selectedText: string;
  bookTitle: string;
  chat: AIChat | null;
  onClose: () => void;
  onSendMessage: (content: string) => void;
  onUpdateChat: (chat: AIChat) => void;
}

function buildSystemPrompt(bookTitle: string, selectedText: string): string {
  return (
    `You are a thoughtful reading assistant helping someone reflect on what they're reading from "${bookTitle}". ` +
    `The user has selected this text:\n\n"${selectedText}"\n\n` +
    `Help them understand and reflect on this passage. Don't just summarize - ask questions that deepen their understanding. ` +
    `Be concise but insightful. If they ask a question, provide a thoughtful response that encourages further reflection.`
  );
}

export function AIChatPanel({
  isOpen,
  selectedText,
  bookTitle,
  chat,
  onClose,
  onSendMessage,
  onUpdateChat,
}: AIChatPanelProps) {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasTriggeredInitialRef = useRef<string | null>(null);

  const messages = chat?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (
      isOpen &&
      chat &&
      messages.length === 1 &&
      messages[0]?.role === "user" &&
      !isStreaming &&
      hasTriggeredInitialRef.current !== chat.id
    ) {
      hasTriggeredInitialRef.current = chat.id;
      void streamResponse(
        [
          { role: "system", content: buildSystemPrompt(bookTitle, selectedText) },
          { role: "user", content: messages[0].content },
        ],
      );
    }
  }, [isOpen, chat?.id]);

  const streamResponse = useCallback(async (apiMessages: ChatMessage[]) => {
    if (!chat) return;
    setIsStreaming(true);
    setStreamingContent("");
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await sendChatCompletionStreaming({
        messages: apiMessages,
        temperature: 0.7,
        maxTokens: 1000,
        onChunk: (text) => {
          setStreamingContent((prev) => prev + text);
        },
        signal: controller.signal,
      });

      // Finalize: add complete message to chat
      const updatedChat = appendMessageToChat(chat, "assistant", response.content);
      onUpdateChat(updatedChat);
      setStreamingContent("");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled -- keep what was streamed so far
        setStreamingContent((current) => {
          if (current) {
            const updatedChat = appendMessageToChat(chat, "assistant", current);
            onUpdateChat(updatedChat);
          }
          return "";
        });
      } else {
        setError(err instanceof Error ? err.message : "Failed to get AI response");
        setStreamingContent("");
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [chat, onUpdateChat]);

  function handleAbort() {
    abortControllerRef.current?.abort();
  }

  async function handleSendMessage() {
    if (!input.trim() || isStreaming || !chat) return;

    const messageContent = input.trim();
    setInput("");

    onSendMessage(messageContent);

    const apiMessages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(bookTitle, selectedText) },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: messageContent },
    ];

    await streamResponse(apiMessages);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSendMessage();
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-stone-950/20 sm:items-center sm:justify-center sm:p-8">
      <div
        className={cn(
          "flex h-[70vh] w-full flex-col border border-border bg-[var(--ra-main-surface-color)] shadow-[0_12px_32px_rgba(28,25,23,0.15)]",
          "sm:h-[min(600px,80vh)] sm:w-[min(480px,100%)] sm:rounded-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <Heading size="xl">Ask AI</Heading>
            <Body className="truncate text-xs text-fg-muted">
              About: &ldquo;{selectedText.slice(0, 60)}{selectedText.length > 60 ? "..." : ""}&rdquo;
            </Body>
          </div>
          <IconButton
            label="Close"
            size="sm"
            onClick={onClose}
            className="ml-2 text-fg-muted hover:text-fg"
            icon={<X size={14} weight="regular" />}
          />
        </div>

        {error && (
          <Alert variant="destructive" className="m-4 mb-0">
            {error}
          </Alert>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex h-full items-center justify-center">
              <Body className="text-center text-fg-muted">
                Start a conversation about this passage.
              </Body>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {isStreaming && streamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg bg-fill px-3 py-2 text-sm leading-relaxed text-fg whitespace-pre-wrap">
                    {streamingContent}
                    <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-fg-subtle" />
                  </div>
                </div>
              )}
              {isStreaming && !streamingContent && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg bg-fill px-3 py-2">
                    <Spinner size="sm" />
                    <Body className="text-xs text-fg-muted">Thinking...</Body>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-border p-4">
          <div className="flex gap-2">
            <TextArea
              label="Message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question or share your thoughts..."
              rows={2}
              className="min-h-[60px] flex-1 resize-none"
              disabled={isStreaming}
            />
            {isStreaming ? (
              <IconButton
                label="Stop generating"
                onClick={handleAbort}
                className="self-end rounded-md border border-border-strong text-fg-muted hover:bg-fg/5 hover:text-fg"
                icon={<Stop size={16} weight="fill" />}
              />
            ) : (
              <Button
                onClick={() => void handleSendMessage()}
                disabled={!input.trim()}
                className="self-end"
              >
                <PaperPlaneRight size={16} weight="regular" />
              </Button>
            )}
          </div>
          <Body className="mt-2 text-[10px] text-fg-subtle">
            {isStreaming ? "Press Stop to cancel" : "Press Cmd+Enter to send"}
          </Body>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: AIChatMessage }) {
  return (
    <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
          message.role === "user"
            ? "bg-fg text-inverse-fg"
            : "bg-fill text-fg",
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

function appendMessageToChat(chat: AIChat, role: AIChatMessage["role"], content: string): AIChat {
  const now = new Date().toISOString();
  return {
    ...chat,
    messages: [
      ...chat.messages,
      {
        id: crypto.randomUUID(),
        role,
        content,
        timestamp: now,
      },
    ],
    updatedAt: now,
  };
}
