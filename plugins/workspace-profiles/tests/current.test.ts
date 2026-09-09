import { expect, test } from "bun:test";
import type { PluginContext, PluginView, SettingsObservation } from "@read-aware/plugin-types";
import { currentWorkspaceView } from "../src/current";

test("current workspace uses host observation, preserves last values on failure and releases its subscription", async () => {
  let handler!: (value: SettingsObservation) => Promise<void>, disposed = 0;
  const published: { revision: number; view: PluginView }[] = [];
  const state = { revision: 3, target: { kind: "global" as const }, overrides: [], settings: [
    { path: "shelf.layout", section: "shelf" as const, kind: "enum" as const, value: "grid", label: "Layout", writable: true },
  ] };
  const ctx = { locale: "en", domains: { settings: { queries: {
    snapshot: async () => state,
    observe: (_query: unknown, next: typeof handler) => { handler = next; return { dispose() { disposed++; } }; },
  } } }, services: { ui: { publishView: async (_channel: unknown, frame: { revision: number; view: PluginView }) => { published.push(frame); } } } } as unknown as PluginContext;
  const view = await currentWorkspaceView(ctx);
  const subscription = await view.live!.subscribe({ id: "current", generation: 1 } as never);
  await handler({ source: "remote", origin: null, status: "ready", snapshot: { ...state, revision: 4, settings: [{ ...state.settings[0], value: "list" }] } });
  expect(JSON.stringify(published[published.length - 1])).toContain("list");
  await handler({ source: "local", origin: null, status: "error", revision: 5, code: "db/locked" });
  expect(JSON.stringify(published[published.length - 1])).toContain("list"); expect(JSON.stringify(published[published.length - 1])).toContain("db/locked");
  await handler({ source: "restore", origin: null, status: "ready", snapshot: state });
  expect(JSON.stringify(published[published.length - 1])).not.toContain("db/locked");
  subscription.dispose(); expect(disposed).toBe(1);
  expect(published.map(frame => frame.revision)).toEqual([1, 2, 3]);
});
