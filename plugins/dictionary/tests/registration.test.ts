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
      ui: {
        registerSelectionAction(action: PluginSelectionAction) {
          selectionAction = action;
          return disposable;
        },
        registerHeaderAction: () => disposable,
        registerCommand: () => disposable,
      },
      dictionary: {},
      agent: { registerTool: () => disposable },
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
