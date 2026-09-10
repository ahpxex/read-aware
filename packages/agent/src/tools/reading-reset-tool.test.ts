import { expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildSettingsTools } from "./settings-tools";

test("reset requires explicit valid scope, resolves the current book and preserves cancellation", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "book" as Id, title: "Book", progressPercent: 0, status: "reading" }] });
  const calls: unknown[] = [], signal = new AbortController().signal;
  deps.settings.resetReading = async (request, received) => {
    calls.push([request, received]); return { changed: [], settings: await deps.settings.getSettings() };
  };
  const tool = buildSettingsTools({ kind: "book", bookId: "book" as Id }, deps).find(tool => tool.name === "reset_reading_settings")!;
  await expect(tool.execute("bad", { action: "inherit", target: { kind: "global" } }, signal)).rejects.toMatchObject({ code: "ui/invalid-target" });
  await expect(tool.execute("missing", { action: "defaults" }, signal)).rejects.toMatchObject({ code: "ui/invalid-target" });
  await expect(tool.execute("cancel", { action: "inherit", target: { kind: "book" } }, AbortSignal.abort())).rejects.toBeDefined();
  expect(calls).toEqual([]);
  await tool.execute("reset", { action: "inherit", target: { kind: "book" } }, signal);
  expect(calls).toEqual([[{ action: "inherit", target: { kind: "book", bookId: "book" } }, signal]]);
});
