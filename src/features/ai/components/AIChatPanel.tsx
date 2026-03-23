/**
 * AI Chat Panel for discussing selected text
 */

import { useState, useRef, useEffect } from "react";
import { Button, TextArea, Body, Heading, IconButton, Alert, Spinner } from "../../../components";
import { X, PaperPlaneRight } from "@phosphor-icons/react";
import { cn } from "../../../components/lib/cn";
import type { AIChat, AIChatMessage } from "../../annotations/lib/annotation-types";
import { sendChatCompletion } from "../lib/ai-service";

export interface AIChatPanelProps {
  isOpen: boolean;
  selectedText: string;
  bookTitle: string;
  chat: AIChat | null;
  onClose: () => void;
  onSendMessage: (content: string) => void;
  onUpdateChat: (chat: AIChat) => void;
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = chat?.messages || [];

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    // Initial AI response when chat is first opened with no messages
    if (isOpen && chat && messages.length === 1 && messages[0]?.role === "user" && !isLoading) {
      void generateInitialResponse();
    }
  }, [isOpen, chat?.id]);

  async function generateInitialResponse() {
    if (!chat) return;
    setIsLoading(true);
    setError(null);

    try {
      const userMessage = messages[0]?.content || "";
      const response = await sendChatCompletion({
        messages: [
          {
            role: "system",
            content:
              `You are a thoughtful reading assistant helping someone reflect on what they're reading from "${bookTitle}". ` +
              `The user has selected this text:\n\n"${selectedText}"\n\n` +
              `Help them understand and reflect on this passage. Don't just summarize - ask questions that deepen their understanding. ` +
              `Be concise but insightful. If they ask a question, provide a thoughtful response that encourages further reflection.`,
          },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
        maxTokens: 1000,
      });

      const updatedChat = await addMessageToChat("assistant", response.content);
      if (updatedChat) {
        onUpdateChat(updatedChat);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get AI response");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSendMessage() {
    if (!input.trim() || isLoading) return;

    const messageContent = input.trim();
    setInput("");
    setIsLoading(true);
    setError(null);

    // Add user message
    onSendMessage(messageContent);

    try {
      const response = await sendChatCompletion({
        messages: [
          {
            role: "system",
            content:
              `You are a thoughtful reading assistant helping someone reflect on what they're reading from "${bookTitle}". ` +
              `The user is discussing this text:\n\n"${selectedText}"\n\n` +
              `Help them understand and reflect on this passage. Don't just summarize - ask questions that deepen their understanding. ` +
              `Be concise but insightful.`,
          },
          ...messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user", content: messageContent },
        ],
        temperature: 0.7,
        maxTokens: 1000,
      });

      const updatedChat = await addMessageToChat("assistant", response.content);
      if (updatedChat) {
        onUpdateChat(updatedChat);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get AI response");
    } finally {
      setIsLoading(false);
    }
  }

  async function addMessageToChat(role: AIChatMessage["role"], content: string): Promise<AIChat | null> {
    if (!chat) return null;
    
    const now = new Date().toISOString();
    const newMessage: AIChatMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: now,
    };

    return {
      ...chat,
      messages: [...chat.messages, newMessage],
      updatedAt: now,
    };
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
          "sm:h-[min(600px,80vh)] sm:w-[min(480px,100%)] sm:rounded-lg"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <Heading size="xl">Ask AI</Heading>
            <Body className="text-xs text-stone-500 line-clamp-1">
              About: "{selectedText.slice(0, 60)}{selectedText.length > 60 ? "..." : ""}"
            </Body>
          </div>
          <IconButton
            label="Close"
            size="sm"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-950"
            icon={<X size={14} weight="regular" />}
          />
        </div>

        {error && (
          <Alert variant="destructive" className="m-4 mb-0">
            {error}
          </Alert>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Body className="text-center text-stone-500">
                Start a conversation about this passage.
              </Body>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    message.role === "user"
                      ? "bg-stone-800 text-white"
                      : "bg-stone-100 text-stone-800"
                  )}
                >
                  {message.content}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2">
                <Spinner size="sm" />
                <Body className="text-xs text-stone-500">AI is thinking...</Body>
              </div>
            </div>
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
            />
            <Button
              onClick={() => void handleSendMessage()}
              disabled={!input.trim() || isLoading}
              className="self-end"
            >
              <PaperPlaneRight size={16} weight="regular" />
            </Button>
          </div>
          <Body className="mt-2 text-[10px] text-stone-400">
            Press Cmd+Enter to send
          </Body>
        </div>
      </div>
    </div>
  );
}
