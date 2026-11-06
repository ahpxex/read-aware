import { afterEach, expect, spyOn, test } from "bun:test";
import * as appEvents from "./app-events";
import * as domainEvents from "./domain-events";
import * as localStore from "./local-store";
import * as roaming from "./roaming-preferences";
import { refreshAfterExternalCommit } from "./external-store-changes";

const restore: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of restore.splice(0).reverse()) cleanup();
});

test("an external commit re-seeds the clock first and announces the push last", async () => {
  const order: string[] = [];
  const reseed = spyOn(domainEvents, "reseedClockFromFrontier").mockImplementation(async () => {
    order.push("reseed");
  });
  const reload = spyOn(localStore, "reloadLocalKVFromStore").mockImplementation(async () => {
    order.push("kv");
    return ["read-aware-general-settings"];
  });
  const refresh = spyOn(roaming, "refreshRoamingPreferences").mockImplementation(async () => {
    order.push("roaming");
  });
  const emit = spyOn(appEvents, "emitAppEvent").mockImplementation((event, payload) => {
    order.push(`${event}${"source" in payload ? `:${String(payload.source)}` : ""}`);
  });
  for (const mock of [reseed, reload, refresh, emit]) restore.push(() => mock.mockRestore());

  await refreshAfterExternalCommit();

  expect(order).toEqual([
    "reseed",
    "kv",
    "projections-invalidated:host",
    "library-changed",
    "conversations-changed",
    "roaming",
    "store-changed-externally",
  ]);
});
