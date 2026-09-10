import { AppError, normalizeConversationTarget, normalizeConversationTurnRequest,
  type ConversationTarget, type ConversationTurnRequest, type ConversationTurnRequestSnapshot,
  type ConversationTurnRequestStatus, type EventOrigin } from "@read-aware/core";

type Surface = {
  state(): { loading: boolean; ready: boolean; generation: object; canRetry: boolean };
  draft(text: string): boolean;
  send(text: string): boolean;
  retry(): boolean;
};
type Entry = {
  snapshot: ConversationTurnRequestSnapshot; owner: EventOrigin; surface?: Surface;
  generation?: object; request?: ConversationTurnRequest; release(): void;
};
export type PendingConversationTurn = ConversationTurnRequestSnapshot & { owner: EventOrigin; text?: string };

/** Only a mounted host surface can accept proposals; public actors never get that operation. */
export class ConversationTurnRequests {
  private surfaces = new Map<string, Surface>();
  private entries = new Map<string, Entry>();
  constructor(private changed: () => void, private lifetimeMs = 300_000) {}

  bind(input: ConversationTarget, surface: Surface) {
    const target = normalizeConversationTarget(input);
    this.cancelTarget(target.id);
    this.surfaces.set(target.id, surface);
    return () => {
      if (this.surfaces.get(target.id) !== surface) return;
      this.cancelTarget(target.id);
      this.surfaces.delete(target.id);
    };
  }
  list(owner: EventOrigin): ConversationTurnRequestSnapshot[] {
    return [...this.entries.values()].filter(entry => entry.owner === owner).map(entry => this.copy(entry));
  }
  pending(targetId: string): PendingConversationTurn | null {
    const entry = [...this.entries.values()].find(item => item.snapshot.target.id === targetId && item.request);
    return entry ? { ...this.copy(entry), owner: entry.owner,
      ...(entry.request && "text" in entry.request ? { text: entry.request.text } : {}) } : null;
  }
  request(owner: EventOrigin, input: ConversationTurnRequest, signal?: AbortSignal) {
    const request = normalizeConversationTurnRequest(input);
    signal?.throwIfAborted();
    const surface = this.surfaces.get(request.target.id), state = surface?.state();
    if (!surface || !state || state.loading || (request.action !== "draft" && !state.ready)) throw new AppError("ui/unavailable", "Open an idle conversation before requesting a turn");
    if (request.action === "retry" && !state.canRetry) throw new AppError("ui/unavailable", "Conversation has no user turn to retry");
    if (this.pending(request.target.id)) throw new AppError("ui/unavailable", "Conversation already has a pending request");
    if (this.entries.size >= 128) {
      const oldest = [...this.entries].find(([, entry]) => !entry.request);
      if (!oldest) throw new AppError("ui/unavailable", "Conversation request limit reached");
      this.entries.delete(oldest[0]);
    }
    const id = crypto.randomUUID();
    const cancel = () => this.finish(entry, "cancelled");
    const timer = setTimeout(() => this.finish(entry, "expired"), this.lifetimeMs);
    const entry: Entry = { owner, surface, generation: state.generation, request,
      snapshot: { id, target: request.target, action: request.action, status: "pending", createdAt: Date.now() },
      release: () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); } };
    this.entries.set(id, entry);
    signal?.addEventListener("abort", cancel, { once: true });
    this.changed();
    return this.copy(entry);
  }
  cancel(owner: EventOrigin, id: string) {
    const entry = typeof id === "string" ? this.entries.get(id) : undefined;
    if (!entry || entry.owner !== owner) throw new AppError("ui/invalid-target", "Conversation request does not exist for this actor");
    this.finish(entry, "cancelled");
    return this.copy(entry);
  }
  cancelTarget(targetId: string) {
    for (const entry of this.entries.values()) if (entry.snapshot.target.id === targetId) this.finish(entry, "cancelled");
  }
  dismiss(id: string) {
    const entry = this.entries.get(id);
    if (entry) this.finish(entry, "dismissed");
  }
  accept(id: string) {
    const entry = this.entries.get(id), request = entry?.request;
    if (!entry || !request) throw new AppError("ui/unavailable", "Conversation request is no longer pending");
    const surface = this.surfaces.get(request.target.id), state = surface?.state();
    if (!surface || surface !== entry.surface || !state || state.loading
      || (request.action !== "draft" && state.generation !== entry.generation)) {
      this.finish(entry, "stale");
      throw new AppError("ui/unavailable", "Conversation changed since the request");
    }
    if (request.action !== "draft" && !state.ready) throw new AppError("ui/unavailable", "Conversation is busy");
    // Consume before entering host handlers so a double click cannot start two turns.
    this.retire(entry);
    try {
      const accepted = request.action === "draft" ? surface.draft(request.text)
        : request.action === "send" ? surface.send(request.text) : surface.retry();
      if (!accepted) throw new AppError("ui/unavailable", "Conversation could not accept the request");
      entry.snapshot.status = request.action === "draft" ? "adopted" : "started";
    } catch (error) { entry.snapshot.status = "failed"; throw error; }
    finally { this.changed(); }
    return this.copy(entry);
  }
  private finish(entry: Entry, status: ConversationTurnRequestStatus) {
    if (!entry.request) return;
    this.retire(entry); entry.snapshot.status = status; this.changed();
  }
  private retire(entry: Entry) {
    entry.release(); entry.request = undefined; entry.surface = undefined; entry.generation = undefined;
    entry.release = () => {};
  }
  private copy(entry: Entry): ConversationTurnRequestSnapshot {
    return { ...entry.snapshot, target: { ...entry.snapshot.target } };
  }
}
