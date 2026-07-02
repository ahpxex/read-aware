/**
 * Agent Lab：真书阅读 + agent 对话 + 内部状态检查器，三件事一屏。
 * 这是 @read-aware/agent 的配套开发工具，与产品（apps/web）完全无关 ——
 * 产品集成走 ChatTransport。
 */
import {
  Article,
  Books,
  Brain,
  ChatCircleDots,
  Flask,
  NotePencil,
  Wrench,
} from "@phosphor-icons/react";
import {
  Alert,
  Body,
  Button,
  Caption,
  Eyebrow,
  Heading,
  Select,
  Spinner,
  Tag,
  TextField,
} from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { KNOWN_PROVIDERS, type KnownProviderId } from "@read-aware/agent";
import { LabComposer } from "./components/LabComposer";
import { LabReader } from "./components/LabReader";
import { LabTranscript } from "./components/LabTranscript";
import {
  annotationCount,
  GLOBAL_THREAD_KEY,
  MODEL_DEFAULTS,
  useAgentLab,
  type LabThread,
} from "./useAgentLab";

const PROVIDER_OPTIONS = KNOWN_PROVIDERS.map((provider) => ({
  label: provider,
  value: provider,
}));

function BookRailItem({
  thread,
  selected,
  progress,
  disabled,
  onSelect,
}: {
  thread: LabThread;
  selected: boolean;
  progress: number;
  disabled: boolean;
  onSelect: () => void;
}) {
  const book = thread.book;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition-colors",
        selected
          ? "border-l-fg bg-surface"
          : "border-l-transparent hover:bg-fg/5",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-12 w-9 shrink-0 items-center justify-center rounded-sm border border-border font-serif text-base",
          book ? "bg-paper-warm text-fg-muted" : "bg-fill text-fg-muted",
        )}
      >
        {book ? book.title.charAt(0) : <Books size={16} weight="regular" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-serif text-sm text-fg">{thread.label}</span>
        {book ? (
          <Caption className="text-fg-subtle">
            {book.author} · {Math.round(progress * 100)}%
            {annotationCount(book.id) > 0 ? ` · ${annotationCount(book.id)} 注` : ""}
          </Caption>
        ) : (
          <Caption className="text-fg-subtle">跨书对话 · Context 页形态</Caption>
        )}
      </span>
    </button>
  );
}

export function AgentLabPage() {
  const lab = useAgentLab();
  const activeThread = lab.threads.find((thread) => thread.key === lab.threadKey);
  const activeBook = activeThread?.book;

  return (
    <div className="flex h-screen flex-col bg-paper">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-baseline gap-3">
          <Heading size="xl" className="flex items-center gap-2 font-serif">
            <Flask size={16} weight="regular" className="text-fg-muted" />
            Agent Lab
          </Heading>
          <Caption className="hidden text-fg-subtle sm:block">
            真书书架 · 内存数据 · 不碰产品存储
          </Caption>
        </div>
        <div className="flex items-center gap-3">
          {lab.sessionStarted && (
            <Caption className="text-fg-subtle">
              {lab.config.provider} · {lab.config.smart}
            </Caption>
          )}
          <Button variant="outline" size="sm" onClick={lab.reset} disabled={!lab.sessionStarted}>
            重置会话
          </Button>
        </div>
      </header>

      {!lab.sessionStarted && (
        <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 border-b border-border bg-paper-warm/40 px-6 py-3 sm:grid-cols-4">
          <Select
            label="Provider"
            options={PROVIDER_OPTIONS}
            value={lab.config.provider}
            onChange={(value) => {
              const provider = value as KnownProviderId;
              lab.setConfig((prev) => ({
                ...prev,
                provider,
                apiKey: __LAB_DEV_KEYS__[provider] ?? "",
                ...MODEL_DEFAULTS[provider],
              }));
            }}
          />
          <TextField
            label="API key"
            type="password"
            value={lab.config.apiKey}
            placeholder="sk-…"
            helperText={lab.config.apiKey ? "已从 pi CLI 自动注入" : undefined}
            onChange={(event) => lab.setConfig((prev) => ({ ...prev, apiKey: event.target.value }))}
          />
          <TextField
            label="smart 模型（聊天）"
            value={lab.config.smart}
            onChange={(event) => lab.setConfig((prev) => ({ ...prev, smart: event.target.value }))}
          />
          <TextField
            label="fast 模型（记忆提炼）"
            value={lab.config.fast}
            onChange={(event) => lab.setConfig((prev) => ({ ...prev, fast: event.target.value }))}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 书架栏：点书进书线程（右侧同时打开阅读视图），底部是全局线程 */}
        <nav className="flex w-60 shrink-0 flex-col border-r border-border">
          <Eyebrow className="px-4 pb-1 pt-3 text-fg-subtle">书架</Eyebrow>
          {lab.threads
            .filter((thread) => thread.book)
            .map((thread) => (
              <BookRailItem
                key={thread.key}
                thread={thread}
                selected={thread.key === lab.threadKey}
                progress={
                  lab.progressById[thread.book?.id ?? ""] ?? thread.book?.progressFraction ?? 0
                }
                disabled={lab.isStreaming}
                onSelect={() => lab.setThreadKey(thread.key)}
              />
            ))}
          <div className="mt-auto border-t border-border">
            <BookRailItem
              thread={lab.threads.find((thread) => thread.key === GLOBAL_THREAD_KEY)!}
              selected={lab.threadKey === GLOBAL_THREAD_KEY}
              progress={0}
              disabled={lab.isStreaming}
              onSelect={() => lab.setThreadKey(GLOBAL_THREAD_KEY)}
            />
          </div>
        </nav>

        {/* 阅读视图：书线程才有；选中文字 → 引用到对话 */}
        {activeBook && (
          <section className="min-w-0 flex-1 border-r border-border">
            <LabReader
              key={activeBook.id}
              url={activeBook.file}
              onRelocate={(position) => lab.reportPosition(activeBook.id, position)}
              onQuote={(quote) => lab.setPendingQuote(quote)}
            />
          </section>
        )}

        {/* 对话 */}
        <section
          className={cn(
            "flex min-h-0 flex-col bg-paper",
            activeBook ? "w-[26rem] shrink-0" : "min-w-0 flex-1",
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
            <ChatCircleDots size={14} weight="regular" className="text-fg-muted" />
            <Body className="text-sm text-fg">{activeThread?.label}</Body>
            <Tag className="ml-auto">{lab.threadKey}</Tag>
          </div>
          <div className="min-h-0 flex-1">
            <LabTranscript
              messages={lab.messages}
              isStreaming={lab.isStreaming}
              streamingText={lab.streamingText}
              status={lab.status}
            />
          </div>
          {lab.error && (
            <div className="shrink-0 px-4 pb-2">
              <Alert variant="destructive" title="出错了">
                {lab.error}
              </Alert>
            </div>
          )}
          <div className="shrink-0 border-t border-border p-3">
            <LabComposer
              isStreaming={lab.isStreaming}
              pendingQuote={lab.pendingQuote}
              onRemoveQuote={() => lab.setPendingQuote(null)}
              onSend={lab.send}
              onStop={lab.stop}
            />
          </div>
        </section>

        {/* 检查器：产品 UI 不会展示的内部状态 */}
        <aside className="w-[21rem] shrink-0 overflow-y-auto border-l border-border">
          <section className="border-b border-border px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <Eyebrow className="flex items-center gap-1.5 text-fg-muted">
                <Brain size={12} weight="regular" /> 记忆 · {lab.memories.length}
              </Eyebrow>
              {lab.isExtracting && (
                <Caption className="flex items-center gap-1 text-fg-subtle">
                  <Spinner size="sm" /> 提炼中
                </Caption>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {lab.memories.length === 0 && !lab.isExtracting && (
                <Caption className="text-fg-subtle">
                  还没有记忆 —— 每轮结束后 fast 模型异步提炼。
                </Caption>
              )}
              {lab.memories.map((memory) => (
                <div key={memory.id} className="rounded-md bg-surface p-2.5 shadow-sm">
                  <Body className="text-sm leading-relaxed">{memory.content}</Body>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Tag>{memory.scope}</Tag>
                    <Tag>{memory.kind}</Tag>
                    <Caption className="ml-auto text-fg-subtle">
                      {memory.importance.toFixed(2)} · ×{memory.evidenceCount}
                    </Caption>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="border-b border-border px-4 py-4">
            <Eyebrow className="mb-3 flex items-center gap-1.5 text-fg-muted">
              <Article size={12} weight="regular" /> 线程摘要
            </Eyebrow>
            {lab.insights ? (
              <Body className="text-sm leading-relaxed text-fg-muted">{lab.insights}</Body>
            ) : (
              <Caption className="text-fg-subtle">
                每轮结束后 fast 模型把对话折叠进滚动摘要 —— 长线程的压缩层。
              </Caption>
            )}
          </section>

          <section className="border-b border-border px-4 py-4">
            <Eyebrow className="mb-3 flex items-center gap-1.5 text-fg-muted">
              <NotePencil size={12} weight="regular" /> ASK-NOTES · {lab.asks.length}
            </Eyebrow>
            <div className="flex flex-col gap-2">
              {lab.asks.length === 0 && (
                <Caption className="text-fg-subtle">书线程的每个提问自动留痕在这里。</Caption>
              )}
              {lab.asks.map((ask, index) => (
                <div key={index} className="rounded-md bg-surface p-2.5 shadow-sm">
                  <Body className="text-sm">{ask.question}</Body>
                  <Caption className="mt-1 block truncate text-fg-subtle">
                    {ask.bookId}
                    {ask.chapter ? ` · ${ask.chapter}` : ""} ·{" "}
                    {ask.anchor ? `锚 ${ask.anchor}` : "未锚定"}
                  </Caption>
                </div>
              ))}
            </div>
          </section>

          <section className="px-4 py-4">
            <Eyebrow className="mb-3 flex items-center gap-1.5 text-fg-muted">
              <Wrench size={12} weight="regular" /> 工具调用 ·{" "}
              {lab.toolLog.filter((entry) => entry.phase === "start").length}
            </Eyebrow>
            <div className="flex flex-col gap-1">
              {lab.toolLog.length === 0 && (
                <Caption className="text-fg-subtle">agent 调用检索/记忆工具时记录在这里。</Caption>
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
                  <span className="ml-auto truncate text-fg-subtle">{entry.threadKey}</span>
                </Caption>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
