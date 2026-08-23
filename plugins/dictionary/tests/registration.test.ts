import { describe, expect, test } from "bun:test";
import type {
  PluginContext,
  PluginSelectionAction,
} from "@read-aware/plugin-types";
import plugin from "../src/index";

describe("Dictionary contributions", () => {
  test("provides the host lookup role instead of a second lookup action", async () => {
    let selectionAction: PluginSelectionAction | null = null;
    const disposable = { dispose() {} };
    const context = {
      contributions: {
        selectionActions: {
          register(action: PluginSelectionAction) {
            selectionAction = action;
            return disposable;
          },
        },
        headerActions: { register: () => disposable },
        commands: { register: () => disposable },
        agentTools: { register: () => disposable },
      },
      services: {
        llm: {},
        session: { subscribe: () => disposable },
      },
      locale: "en",
    } as unknown as PluginContext;

    await plugin.activate(context);

    expect(selectionAction).toMatchObject({
      id: "lookup-save",
      title: "Look up",
      role: "lookup",
      presentation: "dialog",
    });
  });
});
