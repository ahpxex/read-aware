import { bookmarkCollection, bookmarkName, captureBookmark, openBookmark, parseBookmark, removeBookmark, writeBookmark, type Bookmark } from "./bookmarks";
import type { JumperContext } from "./types";

const invalid = (): never => { throw Object.assign(Error("Invalid bookmark tool input"), { code: "plugin/invalid-input" }); };
function fields(params: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(params).some(key => !allowed.includes(key))) invalid();
}
function text(value: unknown, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return invalid();
  return value;
}
function kind(value: unknown): Bookmark["kind"] {
  if (value !== "location" && value !== "selection") return invalid();
  return value;
}
async function locationToken(bookmark: Bookmark) {
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: bookmark.kind, target: bookmark.target }));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `bm1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
const string = (maxLength = 512) => ({ type: "string", minLength: 1, maxLength });

export function registerBookmarkTools(ctx: JumperContext): void {
  if (!ctx.contributions.agentTools) throw Error("Jumper requires agent:tools");
  ctx.contributions.agentTools.register({ name: "list_bookmarks", label: "List bookmarks", contexts: ["global"],
      description: "List a bounded page of Jumper bookmarks, optionally for an exact bookId. Returns ids and revisions for subsequent approved operations, not source text or raw locators. Keep the same book filter and returned cursor when paging. Any collection write invalidates the cursor: restart on stale-cursor. Invalid entries may be explicitly deleted, not opened or renamed.",
      parameters: { type: "object", properties: { bookId: string(), cursor: string(8192), limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
      execute: async params => {
        fields(params, ["bookId", "cursor", "limit"]);
        const limit = params.limit ?? 10;
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) return invalid();
        const page = await bookmarkCollection(ctx).page({ limit,
          ...(params.bookId === undefined ? {} : { bookId: text(params.bookId) }),
          ...(params.cursor === undefined ? {} : { cursor: text(params.cursor, 8192) }),
        });
        if (page.status === "stale-cursor") return page;
        return { status: "ready", nextCursor: page.nextCursor, items: page.items.map(doc => {
          const bookmark = parseBookmark(doc.data);
          return { id: doc.id, revision: doc.revision, valid: Boolean(bookmark), ...(bookmark ? {
            name: bookmark.name, kind: bookmark.kind, bookId: bookmark.target.bookId,
            bookTitle: bookmark.bookTitle.slice(0, 160), bookTitleTruncated: bookmark.bookTitle.length > 160,
          } : {}) };
        }) };
      },
    });
  ctx.contributions.agentTools.register({ name: "inspect_bookmark_location", label: "Inspect bookmark location", contexts: ["global"],
      description: "Inspect the current reading location or readable selection before saving a Jumper bookmark. Returns book metadata and an opaque locationToken, not full source text. Does not save or navigate. Pass the unchanged kind, bookId and token to save_bookmark; that operation refuses a changed position or selection. A source may have session-limited validity.",
      parameters: { type: "object", properties: { kind: { type: "string", enum: ["location", "selection"] } }, required: ["kind"], additionalProperties: false },
      execute: async params => {
        fields(params, ["kind"]);
        const bookmark = await captureBookmark(ctx, kind(params.kind));
        return { kind: bookmark.kind, bookId: bookmark.target.bookId, bookTitle: bookmark.bookTitle,
          suggestedName: bookmark.name, locationToken: await locationToken(bookmark) };
      },
    });
  ctx.contributions.agentTools.register({ name: "save_bookmark", label: "Save bookmark", contexts: ["global"], approval: "required",
      description: "After host approval, save the current reading location or selection previously inspected with inspect_bookmark_location. Pass its exact kind, bookId and locationToken plus the requested name. Rechecks the target before writing and returns stale-location rather than capturing a different position. Saves only a private Jumper bookmark, not an annotation or reading-history event. Does not navigate. Repeated successful calls may create separate bookmarks.",
      parameters: { type: "object", properties: { kind: { type: "string", enum: ["location", "selection"] }, bookId: string(),
        locationToken: { type: "string", pattern: "^bm1:[a-f0-9]{64}$" }, name: string(120) }, required: ["kind", "bookId", "locationToken", "name"], additionalProperties: false },
      execute: async params => {
        fields(params, ["kind", "bookId", "locationToken", "name"]);
        const selectedKind = kind(params.kind), bookId = text(params.bookId), token = text(params.locationToken, 68), name = bookmarkName(params.name);
        if (!name || !/^bm1:[a-f0-9]{64}$/.test(token)) return invalid();
        const bookmark = await captureBookmark(ctx, selectedKind);
        if (bookmark.target.bookId !== bookId || await locationToken(bookmark) !== token) return { status: "stale-location" };
        // Save the checked immutable target even if the reader moves during this write.
        const id = crypto.randomUUID(), receipt = await writeBookmark(ctx, id, { ...bookmark, name }, null);
        return receipt.status === "conflict" ? { status: "conflict" } : { status: "saved", id, name, bookId };
      },
    });
  ctx.contributions.agentTools.register({ name: "manage_bookmark", label: "Manage bookmark", contexts: ["global"], approval: "required",
      description: "Open, rename or permanently delete one Jumper bookmark after host approval. First list_bookmarks and pass the exact id and expectedRevision; a changed document returns conflict. Rename requires name; other actions must omit it. Open uses the stored book and content version through shared navigation, rejects removed/stale sources and never guesses a replacement location. Delete removes only this bookmark, not its book or annotations. Invalid entries can only be deleted.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["open", "rename", "delete"] }, id: string(), expectedRevision: string(), name: string(120) },
        required: ["action", "id", "expectedRevision"], additionalProperties: false },
      execute: async params => {
        fields(params, ["action", "id", "expectedRevision", "name"]);
        const id = text(params.id), expectedRevision = text(params.expectedRevision);
        if (typeof params.action !== "string" || !["open", "rename", "delete"].includes(params.action)) return invalid();
        const name = params.action === "rename" ? bookmarkName(params.name) : null;
        if (params.action === "rename" ? !name : params.name !== undefined) return invalid();
        const doc = await bookmarkCollection(ctx).get(id);
        if (!doc) return { status: "not-found", id };
        if (doc.revision !== expectedRevision) return { status: "conflict", id };
        if (params.action === "delete") {
          const receipt = await removeBookmark(ctx, doc);
          return { status: receipt.status === "conflict" ? "conflict" : "deleted", id };
        }
        const bookmark = parseBookmark(doc.data);
        if (!bookmark) return { status: "invalid-bookmark", id };
        if (params.action === "rename") {
          const receipt = await writeBookmark(ctx, id, { ...bookmark, name: name! }, expectedRevision);
          return { status: receipt.status === "conflict" ? "conflict" : "renamed", id };
        }
        await openBookmark(ctx, bookmark);
        return { status: "completed", action: "open", id, bookId: bookmark.target.bookId };
      },
    });
}
