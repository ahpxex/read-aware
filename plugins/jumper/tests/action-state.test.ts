import { expect, test } from "bun:test";
import type { PluginActionState, PluginContext, PluginHeaderAction, PluginCommand } from "@read-aware/plugin-types";
import plugin from "../src/index";

type Session = Awaited<ReturnType<NonNullable<PluginContext["domains"]["reading"]>["queries"]["session"]>>;

test("Jumper composes observed session readiness with action availability", async () => {
  const states = new Map<string, PluginActionState>();
  let observe!: (session: Session) => Promise<void>;
  const register = (action: PluginHeaderAction | PluginCommand) => {
    states.set(action.id, action.state!);
    return {
      dispose() {},
      async updateState(state: PluginActionState) {
        if (state.revision <= states.get(action.id)!.revision) return { status: "stale" as const };
        states.set(action.id, state);
        return { status: "applied" as const };
      },
    };
  };
  await plugin.activate({
    withEvent: (_event: unknown, registration: unknown) => registration,
    locale: "en",
    contributions: {
      commands: { register },
      headerActions: { register },
      agentTools: { register: () => ({ dispose() {} }) },
    },
    domains: {
      library: {},
      reading: {
        commands: {},
        events: {
          observeSession(handler: typeof observe) {
            observe = handler;
          },
        },
      },
    },
  } as unknown as PluginContext);
  const readerStates = () => [...states].filter(([id]) => id !== "bookmarks").map(([, state]) => state);
  expect(readerStates().every((state) => !state.enabled)).toBe(true);
  expect(states.get("bookmarks")?.enabled).toBe(true);
  const session = (revision: number, status: Session["status"], back: boolean, forward: boolean) =>
    ({ revision, status, history: { canGoBack: back, canGoForward: forward } }) as Session;
  await observe(session(1, "ready", true, false));
  expect(states.get("jumper")?.enabled).toBe(true);
  expect(states.get("open")?.enabled).toBe(true);
  // History commands belong to the reader now; the plugin registers none.
  expect(states.has("back")).toBe(false);
  expect(states.has("forward")).toBe(false);
  for (const [index, status] of (["loading", "error", "idle"] as const).entries()) {
    await observe(session(index + 2, status, true, true));
    expect(readerStates().every((state) => !state.enabled)).toBe(true);
    expect(states.get("bookmarks")?.enabled).toBe(true);
    expect([...states.values()].every((state) => state.visible)).toBe(true);
  }
});
