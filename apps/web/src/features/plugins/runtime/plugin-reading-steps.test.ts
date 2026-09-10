import { expect, test } from "bun:test";
import type { PluginPermission, ReadingLocation } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import { buildPluginContext } from "./plugin-context";

test("chapter steps use the reading grant and shared controller, then reject retired plugin calls", async () => {
  const create = (permissions: PluginPermission[]) => buildPluginContext({ id: `reading-steps-${permissions.join("-").replaceAll(":", "-") || "none"}`, name: "Steps",
    version: "1", schemaVersion: 1, requires: {}, permissions }, "0.5.4", []);
  const none = create([]), read = create(["reading:read"]), write = create(["reading:write"]);
  const at = (cfi: string): ReadingLocation => ({ bookId: "steps-book", contentVersion: "v1", cfi });
  const sessionId = readingRuntime.begin("steps-book"), directions: string[] = [];
  const detach = readingRuntime.attach(sessionId, { navigate: async target => at(target.cfi ?? "start"),
    step: async direction => { directions.push(direction); return at(direction); } }, at("start"));
  try {
    expect(none.context.domains.reading).toBeUndefined();
    expect(read.context.domains.reading?.commands).toBeUndefined();
    const step = write.context.domains.reading!.commands!.step;
    expect(() => step("next-chapter")).toThrow();
    write.lifecycle.promote();
    for (const direction of ["next-chapter", "previous-chapter"] as const) {
      expect((await step(direction, { sessionId })).location.cfi).toBe(direction);
    }
    expect(directions).toEqual(["next-chapter", "previous-chapter"]);
    await expect(step("next-chapter", { sessionId: "stale" })).rejects.toMatchObject({ code: "reader/superseded" });
    write.lifecycle.stop(); expect(() => step("next-chapter")).toThrow();
  } finally { detach(); none.lifecycle.stop(); read.lifecycle.stop(); write.lifecycle.stop(); }
});
