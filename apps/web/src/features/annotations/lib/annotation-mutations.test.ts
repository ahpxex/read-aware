import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import * as environment from "../../../platform/environment";
import * as ipc from "../../../platform/ipc";
import * as events from "../../../platform/domain-events";
import { commitAnnotationMutations } from "./annotation-mutations";

const cleanups: (() => void)[] = [];
const own = <T extends { mockRestore(): void }>(spy: T): T => { cleanups.push(() => spy.mockRestore()); return spy; };
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const changes = [{ op: "updateNote" as const, annotationId: "note", body: "New", expectedRevision: `ann1:${"a".repeat(64)}` }];

test("native conditional commit owns events and broadcasts only a successful transaction", async () => {
  own(spyOn(environment, "isTauri").mockReturnValue(true));
  const mint = own(spyOn(events, "mintEventRows").mockResolvedValue([]));
  const broadcast = own(spyOn(events, "broadcastDomainEventDrafts").mockImplementation(() => {}));
  const invoke = own(spyOn(ipc, "invoke").mockRejectedValue(new AppError("annotations/conflict", "Stale")));
  await expect(commitAnnotationMutations(changes, "plugin:writer")).rejects.toMatchObject({ code: "annotations/conflict" });
  expect(broadcast).not.toHaveBeenCalled();
  expect(mint).toHaveBeenCalledWith([{ type: "note.updated", payload: { noteId: "note", body: "New" }, origin: "plugin:writer" }]);
  const receipt = { atomic: true as const, changes: [{ annotationId: "note", revision: "next" }] };
  invoke.mockResolvedValue(receipt);
  expect(await commitAnnotationMutations(changes, "agent")).toEqual(receipt);
  expect(invoke).toHaveBeenLastCalledWith("annotations_commit", { events: [], conditions: [{ annotationId: "note", expectedRevision: changes[0].expectedRevision }] });
  expect(broadcast).toHaveBeenCalledTimes(1);
});

test("retirement while minting prevents IPC and never announces a write", async () => {
  own(spyOn(environment, "isTauri").mockReturnValue(true));
  const controller = new AbortController();
  own(spyOn(events, "mintEventRows").mockImplementation(async () => { controller.abort(); return []; }));
  const invoke = own(spyOn(ipc, "invoke").mockResolvedValue(undefined));
  const broadcast = own(spyOn(events, "broadcastDomainEventDrafts").mockImplementation(() => {}));
  await expect(commitAnnotationMutations(changes, "plugin:retiring", controller.signal)).rejects.toMatchObject({ code: "annotations/cancelled" });
  expect(invoke).not.toHaveBeenCalled(); expect(broadcast).not.toHaveBeenCalled();
});
