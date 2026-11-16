import {
  actorFromEvent,
  actorOrigin,
  causalActor,
  stampEventCause,
  type DomainActor,
} from "../../../platform/domain-actor";
import { AppError } from "@read-aware/core";
import { runDomainWrite } from "../../../platform/domain-write-gate";
import { invoke } from "../../../platform/ipc";
import { isTauri } from "../../../platform/environment";
import { commitDomainEventBatch, type CommitReport, type DomainEventDraft } from "../../../platform/domain-events";
import { createLogger } from "../../../platform/logger";
import type { ChatAssistantPart, ChatAttachment, ChatMessage } from "./chat-types";

const log = createLogger("conversation-store");

/**
 * Local persistence for the per-book conversation.
 *
 * Desktop (the product): SQLite `ai_conversations` / `ai_messages`
 * (storage.rs migration v6) — one row per message, tombstoned clear.
 * This store is the ONE transcript writer: the chat surface saves through it,
 * and the agent runtime only reads (ConversationPort in @read-aware/agent).
 * Saves derive the conversation domain events by diffing against the
 * last-known persisted transcript: `aiConversation.started` on the empty →
 * non-empty transition, `aiMessage.appended` per committed message (origin
 * "user"/"agent" by role), `aiMessage.removed` per truncated one (without it,
 * replay would resurrect retried turns). `ai_chat_commit` appends and applies
 * those events AND writes the presentation-only state — rendered `parts`, the
 * display `seq`, device-local error stubs — in ONE native transaction. It never
 * writes an event-owned column itself and never touches rows this webview
 * doesn't know (a sync merge may have written peer rows it never loaded).
 *
 * Browser (dev / Storybook): a session-scoped in-memory map. Deliberately NOT
 * a persistence fallback — the browser build is a pure UI shell and the mock
 * transport only needs the transcript to survive within the session.
 */

/** 首个全局线程的存储 id（历史遗留名；新建的全局线程用 thread-<uuid>）。 */
export const GLOBAL_CONVERSATION_ID = "__global__";

/** 全局线程的 id 形状 —— 借此把书线程（裸 bookId）和全局线程区分开。 */
export function isGlobalThreadId(id: string): boolean {
  return id === GLOBAL_CONVERSATION_ID || id.startsWith("thread-");
}

/** 新建全局线程的 id（会话行在第一条消息落库时才产生）。 */
export function newGlobalThreadId(): string {
  return `thread-${crypto.randomUUID()}`;
}

export interface ConversationSummary {
  id: string;
  updatedAt: string;
  messageCount: number;
  /** 首条用户消息（线程还没有生成标题时，列表拿它当标题）。 */
  preview?: string;
  /** 生成的标题（`aiConversation.titled`）；生成前缺省。 */
  title?: string;
}

/** The longest title a thread may carry (mirrors the store's bound). */
export const MAX_THREAD_TITLE_CHARS = 120;

/** Row shape of the SQLite `ai_messages` projection (see storage.rs). */
interface AiMessageRow {
  id: string;
  conversationId: string;
  role: string;
  seq: number;
  content: string;
  createdAt: string;
  attachmentsJson?: string;
  partsJson?: string;
  error?: string;
}

function rowToMessage(row: AiMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    content: row.content,
    createdAt: row.createdAt,
    attachments: row.attachmentsJson ? (JSON.parse(row.attachmentsJson) as ChatAttachment[]) : undefined,
    parts: row.partsJson ? (JSON.parse(row.partsJson) as ChatAssistantPart[]) : undefined,
    error: row.error || undefined,
  };
}

function messageToRow(conversationId: string, message: ChatMessage, seq: number): AiMessageRow {
  return {
    id: message.id,
    conversationId,
    role: message.role,
    seq,
    content: message.content,
    createdAt: message.createdAt,
    attachmentsJson: message.attachments ? JSON.stringify(message.attachments) : undefined,
    partsJson: message.parts ? JSON.stringify(message.parts) : undefined,
    error: message.error,
  };
}

/** Presentation state for `ai_chat_commit`, numbered in transcript order:
 *  event-backed messages contribute only `seq` + `partsJson`; error stubs are
 *  device-local rows no event describes, so they travel whole. */
function presentationRows(conversationId: string, messages: ChatMessage[]) {
  const presentation: Array<Pick<AiMessageRow, "id" | "seq" | "partsJson">> = [];
  const errorStubs: AiMessageRow[] = [];
  messages.forEach((message, seq) => {
    const row = messageToRow(conversationId, message, seq);
    if (message.error) errorStubs.push(row);
    else presentation.push({ id: row.id, seq, partsJson: row.partsJson });
  });
  return { presentation, errorStubs };
}

const memoryStore = new Map<string, ChatMessage[]>();

// ─── Event dual-write bookkeeping ────────────────────────────────────────────

/** Ids of the event-covered (non-error) messages last seen persisted. */
const knownEventIds = new Map<string, Set<string>>();

const eventable = (messages: ChatMessage[]): ChatMessage[] => messages.filter((message) => !message.error);

function toAppendedDraft(conversationId: string, message: ChatMessage, seq: number): DomainEventDraft {
  return {
    type: "aiMessage.appended",
    payload: {
      messageId: message.id,
      conversationId,
      role: message.role,
      seq,
      content: message.content,
      attachments: message.attachments?.map((attachment) =>
        attachment.kind === "image"
          ? {
              attachmentId: crypto.randomUUID(),
              kind: "image" as const,
              cacheKey: attachment.cacheKey,
              name: attachment.name,
            }
          : {
              attachmentId: crypto.randomUUID(),
              kind: attachment.kind,
              text: attachment.text,
              anchor: attachment.cfiRange ?? undefined,
              chapterHref: attachment.chapterHref ?? undefined,
            },
      ),
    },
    createdAt: message.createdAt,
    // The user's turns are their writes; the assistant's are the agent's.
    origin: message.role === "assistant" ? "agent" : "user",
  };
}

/** Diff the new transcript against the last persisted one into event drafts. */
async function conversationEventDrafts(conversationId: string, messages: ChatMessage[]): Promise<DomainEventDraft[]> {
  let prev = knownEventIds.get(conversationId);
  if (!prev) {
    // First save without a prior load (defensive) — baseline from the store.
    const rows = await invoke<AiMessageRow[]>("ai_chat_load", { conversationId });
    prev = new Set(rows.filter((row) => !row.error).map((row) => row.id));
    knownEventIds.set(conversationId, prev);
  }
  const next = eventable(messages);
  const nextIds = new Set(next.map((message) => message.id));
  const drafts: DomainEventDraft[] = [];

  if (prev.size === 0 && next.length > 0) {
    drafts.push({
      type: "aiConversation.started",
      payload: {
        conversationId,
        bookId: isGlobalThreadId(conversationId) ? undefined : conversationId,
      },
      createdAt: next[0]?.createdAt,
    });
  }
  // Removals first: a retried turn's replacement reuses the removed message's
  // position, so the tombstone must precede the append in the applied order.
  for (const id of prev) {
    if (!nextIds.has(id)) {
      drafts.push({ type: "aiMessage.removed", payload: { messageId: id, conversationId } });
    }
  }
  for (const [seq, message] of next.entries()) {
    if (!prev.has(message.id)) drafts.push(toAppendedDraft(conversationId, message, seq));
  }
  return drafts;
}

export async function loadConversation(conversationId: string): Promise<ChatMessage[]> {
  if (!isTauri()) return memoryStore.get(conversationId) ?? [];
  const rows = await invoke<AiMessageRow[]>("ai_chat_load", { conversationId });
  knownEventIds.set(conversationId, new Set(rows.filter((row) => !row.error).map((row) => row.id)));
  return rows.map(rowToMessage);
}

/** 全量转录（agent 的 search_conversation 原话检索用）。 */
export async function loadAllConversations(): Promise<Record<string, ChatMessage[]>> {
  if (!isTauri()) return Object.fromEntries(memoryStore);
  const rows = await invoke<AiMessageRow[]>("ai_chat_load_all");
  const grouped: Record<string, ChatMessage[]> = {};
  for (const row of rows) {
    (grouped[row.conversationId] ??= []).push(rowToMessage(row));
  }
  return grouped;
}

export async function saveConversation(
  conversationId: string,
  messages: ChatMessage[],
  origin?: DomainActor,
): Promise<void> {
  const source = origin === undefined ? undefined : stampEventCause({}, causalActor(origin));
  if (!isTauri()) {
    memoryStore.set(conversationId, messages);
    return;
  }
  const captured = structuredClone(messages);
  return runDomainWrite(async () => {
    try {
      // The events carry the conversation facts (role/seq/content/attachments);
      // the presentation carries only what no event describes — exactly the
      // columns DIFF_SPECS in storage/apply.rs excludes from the consistency
      // check. Both land in one transaction or neither does.
      const drafts = (await conversationEventDrafts(conversationId, captured)).map((draft) =>
        source ? { ...draft, origin: actorFromEvent(source, actorOrigin(draft.origin ?? origin!)) } : draft,
      );
      const { presentation, errorStubs } = presentationRows(conversationId, captured);
      await commitDomainEventBatch(drafts, {
        dispatch: (events) =>
          invoke<CommitReport>("ai_chat_commit", { conversationId, events, presentation, errorStubs }),
      });
      knownEventIds.set(conversationId, new Set(eventable(captured).map((m) => m.id)));
    } catch (err) {
      // Keep the live transcript, but do not report durable completion on failure.
      log.error("persist failed", err);
      throw err;
    }
  });
}

export async function clearConversation(
  conversationId: string,
  origin: DomainActor = "user",
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!isTauri()) {
    memoryStore.delete(conversationId);
    memoryTitles.delete(conversationId);
    return;
  }
  // The event deletes every message (including local error stubs) and
  // tombstones in the same transaction. No second projection write can
  // overwrite the event timestamp or erase a subsequently appended turn.
  const draft: DomainEventDraft = { type: "aiConversation.cleared", payload: { conversationId }, origin };
  await commitDomainEventBatch([draft], { signal });
  knownEventIds.set(conversationId, new Set());
}

/** Preview-mode titles (the desktop store keeps them in its projection). */
const memoryTitles = new Map<string, string>();

/**
 * Name a global thread (`aiConversation.titled`): host-internal, written by
 * the agent after the thread's first exchange. `messageId` is the first user
 * message the title was written from; the store drops a title whose message
 * has left the thread (a clear and a new exchange in between).
 */
export async function titleConversation(
  conversationId: string,
  title: string,
  messageId: string,
  origin: DomainActor = "agent",
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const text = title.trim();
  if (!isGlobalThreadId(conversationId))
    throw new AppError("ui/invalid-target", "Only a global thread carries a title");
  // Counted in code points on purpose: the store bounds the title with Rust's
  // `chars().count()`, which counts Unicode scalar values, not graphemes.
  // oxlint-disable-next-line no-misused-spread
  if (!text || [...text].length > MAX_THREAD_TITLE_CHARS || !messageId)
    throw new AppError("ui/invalid-target", "A thread title is 1–120 characters and names its first message");
  if (!isTauri()) {
    if (memoryStore.get(conversationId)?.some((message) => message.id === messageId))
      memoryTitles.set(conversationId, text);
    return;
  }
  const draft: DomainEventDraft = {
    type: "aiConversation.titled",
    payload: { conversationId, title: text, messageId },
    origin,
  };
  await commitDomainEventBatch([draft], { signal });
}

/** 全局线程列表（非空会话，按最近活动排序）。 */
export async function listGlobalThreads(): Promise<ConversationSummary[]> {
  if (!isTauri()) {
    return [...memoryStore.entries()]
      .filter(([id, messages]) => isGlobalThreadId(id) && messages.length > 0)
      .map(([id, messages]) => ({
        id,
        updatedAt: messages[messages.length - 1]?.createdAt ?? "",
        messageCount: messages.length,
        preview: messages.find((m) => m.role === "user")?.content,
        title: memoryTitles.get(id),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const all = await invoke<ConversationSummary[]>("ai_chat_list");
  return all.filter((summary) => isGlobalThreadId(summary.id));
}
