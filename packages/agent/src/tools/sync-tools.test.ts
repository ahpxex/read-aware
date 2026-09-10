import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildSyncTools } from "./sync-tools";

test("sync tools distinguish settings navigation from approved sync and make remote quota reads explicit", async () => {
  const { deps, stores } = createInMemoryDeps(); let syncs = 0, reads = 0;
  deps.sync.requestSync = async () => { syncs++; return { status: "already-running", snapshot: await deps.sync.snapshot() }; };
  deps.sync.account = async () => { reads++; return null; };
  const [read, manage] = buildSyncTools({ kind: "book", bookId: "b1" }, deps);
  await read.execute("status", {}); expect(reads).toBe(0);
  await read.execute("account", { includeAccount: true }); expect(reads).toBe(1);
  expect(JSON.stringify(await manage.execute("settings", { action: "settings" }))).toContain("opened");
  expect(stores.interactions).toHaveLength(0);
  expect(JSON.stringify(await manage.execute("now", { action: "now" }))).toContain("already-running");
  expect(stores.interactions[0]).toMatchObject({ action: "sync-now" }); expect(syncs).toBe(1);
  deps.interactions.request = async () => ({ optionId: "decline" });
  await manage.execute("decline", { action: "now" }); expect(syncs).toBe(1);
  const signal = new AbortController(); signal.abort(Error("cancelled"));
  await expect(manage.execute("cancel", { action: "now" }, signal.signal)).rejects.toThrow("cancelled");
});

test("both scopes discover backend refs and delegate all account flows to host confirmation", async () => {
  for (const scope of [{ kind: "global", threadId: "global-test" }, { kind: "book", bookId: "b1" }] as const) {
    const { deps, stores } = createInMemoryDeps();
    const seen: unknown[] = [];
    deps.sync.connectionOptions = async () => [{ ref: "webdav:main", label: "WebDAV" }];
    deps.sync.requestFlow = async (input, signal) => { signal?.throwIfAborted(); seen.push(input); return { action: input.action, status: "cancelled" }; };
    const [read, manage] = buildSyncTools(scope, deps);
    expect(JSON.stringify(await read.execute("connections", { includeConnections: true }))).toContain("webdav:main");
    for (const action of ["connect", "disconnect", "delete-account", "upgrade", "billing"]) {
      expect(JSON.stringify(await manage.execute(action, { action, ...(action === "connect" ? { transportRef: "webdav:main" } : {}) }))).toContain("cancelled");
    }
    expect(seen).toHaveLength(5); expect(seen[0]).toEqual({ action: "connect", transportRef: "webdav:main" });
    // The native dialog, not a second Agent approval token, owns confirmation.
    expect(stores.interactions).toHaveLength(0);
    await expect(manage.execute("invalid", { action: "delete-account", transportRef: "webdav:main" })).rejects.toMatchObject({ code: "ui/invalid-target" });
  }
});
