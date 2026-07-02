/**
 * Agent Workbench（dev-only，/agent-lab）：左边和 agent 聊，右边看内部状态
 * （记忆提炼、ask-note、工具调用）。数据全在内存 fixture 里，不碰产品存储。
 */
import { Brain, Flask } from "@phosphor-icons/react";
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  Eyebrow,
  Heading,
  Select,
  Spinner,
  Tag,
  TextField,
} from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { ChatComposer } from "../../features/ai/components/ChatComposer";
import { ChatTranscript } from "../../features/ai/components/ChatTranscript";
import { KNOWN_PROVIDERS, type KnownProviderId } from "@read-aware/agent";
import { MODEL_DEFAULTS, useAgentLab } from "./useAgentLab";

const PROVIDER_OPTIONS = KNOWN_PROVIDERS.map((provider) => ({
  label: provider,
  value: provider,
}));

export function AgentLabPage() {
  const lab = useAgentLab();

  if (!import.meta.env.DEV) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Body className="text-fg-muted">Agent lab is dev-only.</Body>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-screen max-w-screen-2xl flex-col gap-4 px-6 py-6">
      <header className="flex items-end justify-between">
        <div>
          <Eyebrow className="flex items-center gap-1.5 text-fg-muted">
            <Flask size={12} weight="regular" /> AGENT LAB · DEV ONLY
          </Eyebrow>
          <Heading size="2xl">Agent Workbench</Heading>
          <Caption className="text-fg-subtle">
            内存 fixture 书架 · 不写产品数据 · 会话内状态右栏实时可见
          </Caption>
        </div>
        <Button variant="outline" size="sm" onClick={lab.reset} disabled={!lab.sessionStarted}>
          重置会话
        </Button>
      </header>

      <Card className="shrink-0">
        <Card.Body className="grid grid-cols-2 gap-x-6 gap-y-3 py-4 sm:grid-cols-4">
          <Select
            label="Provider"
            options={PROVIDER_OPTIONS}
            value={lab.config.provider}
            disabled={lab.sessionStarted}
            onChange={(value) => {
              const provider = value as KnownProviderId;
              lab.setConfig((prev) => ({ ...prev, provider, ...MODEL_DEFAULTS[provider] }));
            }}
          />
          <TextField
            label="API key"
            type="password"
            value={lab.config.apiKey}
            disabled={lab.sessionStarted}
            placeholder="sk-…"
            onChange={(event) =>
              lab.setConfig((prev) => ({ ...prev, apiKey: event.target.value }))
            }
          />
          <TextField
            label="smart 模型（聊天）"
            value={lab.config.smart}
            disabled={lab.sessionStarted}
            onChange={(event) =>
              lab.setConfig((prev) => ({ ...prev, smart: event.target.value }))
            }
          />
          <TextField
            label="fast 模型（记忆提炼）"
            value={lab.config.fast}
            disabled={lab.sessionStarted}
            onChange={(event) => lab.setConfig((prev) => ({ ...prev, fast: event.target.value }))}
          />
        </Card.Body>
      </Card>

      <div className="grid min-h-0 flex-1 grid-cols-5 gap-4">
        <section className="col-span-3 flex min-h-0 flex-col rounded-lg border border-border bg-paper">
          <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
            {lab.threads.map((thread) => (
              <button
                key={thread.key}
                type="button"
                disabled={lab.isStreaming}
                onClick={() => lab.setThreadKey(thread.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm transition-colors",
                  thread.key === lab.threadKey
                    ? "bg-fg/10 text-fg"
                    : "text-fg-muted hover:bg-fg/5",
                )}
              >
                {thread.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            <ChatTranscript
              messages={lab.messages}
              isLoading={false}
              isStreaming={lab.isStreaming}
              streamingText={lab.streamingText}
              status={lab.status}
            />
          </div>
          {lab.error && (
            <div className="shrink-0 px-3 pb-2">
              <Alert variant="destructive" title="出错了">
                {lab.error}
              </Alert>
            </div>
          )}
          <div className="shrink-0 border-t border-border p-3">
            <ChatComposer
              isStreaming={lab.isStreaming}
              pendingAttachment={null}
              onRemoveAttachment={() => {}}
              onSend={lab.send}
              onStop={lab.stop}
            />
          </div>
        </section>

        <aside className="col-span-2 flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          <Card>
            <Card.Header className="flex items-center justify-between">
              <Heading size="xl" className="flex items-center gap-1.5">
                <Brain size={14} weight="regular" /> 记忆（{lab.memories.length}）
              </Heading>
              {lab.isExtracting && (
                <Caption className="flex items-center gap-1 text-fg-subtle">
                  <Spinner size="sm" /> 提炼中…
                </Caption>
              )}
            </Card.Header>
            <Card.Body className="flex flex-col gap-2.5">
              {lab.memories.length === 0 && !lab.isExtracting && (
                <Caption className="text-fg-subtle">
                  还没有记忆 —— 每轮对话结束后 fast 模型会异步提炼。
                </Caption>
              )}
              {lab.memories.map((memory) => (
                <div key={memory.id} className="rounded-md border border-border p-2.5">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Tag>{memory.scope}</Tag>
                    <Tag>{memory.kind}</Tag>
                    <Caption className="ml-auto text-fg-subtle">
                      置信 {memory.importance.toFixed(2)} · 证据 {memory.evidenceCount}
                    </Caption>
                  </div>
                  <Body className="text-sm">{memory.content}</Body>
                </div>
              ))}
            </Card.Body>
          </Card>

          <Card>
            <Card.Header>
              <Heading size="xl">Ask-notes（{lab.asks.length}）</Heading>
            </Card.Header>
            <Card.Body className="flex flex-col gap-2">
              {lab.asks.length === 0 && (
                <Caption className="text-fg-subtle">书线程的每个提问会自动留痕在这里。</Caption>
              )}
              {lab.asks.map((ask, index) => (
                <div key={index} className="rounded-md border border-border p-2.5">
                  <Body className="text-sm">{ask.question}</Body>
                  <Caption className="mt-1 text-fg-subtle">
                    {ask.bookId} · 锚点 {ask.anchor ?? "（无 — 自由提问且未传阅读位置）"}
                  </Caption>
                </div>
              ))}
            </Card.Body>
          </Card>

          <Card>
            <Card.Header>
              <Heading size="xl">工具调用（{lab.toolLog.filter((e) => e.phase === "start").length}）</Heading>
            </Card.Header>
            <Card.Body className="flex flex-col gap-1">
              {lab.toolLog.length === 0 && (
                <Caption className="text-fg-subtle">agent 调用检索/记忆工具时会记录在这里。</Caption>
              )}
              {lab.toolLog.map((entry) => (
                <Caption key={entry.id} className="flex items-center gap-2 text-fg-muted">
                  <span
                    className={cn(
                      "rounded px-1 text-[10px] uppercase",
                      entry.isError ? "bg-red-50 text-red-700" : "bg-fg/5 text-fg-subtle",
                    )}
                  >
                    {entry.phase}
                  </span>
                  <span className="font-mono">{entry.tool}</span>
                  <span className="ml-auto text-fg-subtle">[{entry.threadKey}]</span>
                </Caption>
              ))}
            </Card.Body>
          </Card>
        </aside>
      </div>
    </div>
  );
}
