import { afterEach, expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { setPluginToastHandler, showPluginFailureToast } from "./plugin-toast";
afterEach(() => setPluginToastHandler(null));
test("failure toasts keep stable host codes but never raw error details", () => {
  const payloads: unknown[] = [];
  setPluginToastHandler(payload => payloads.push(payload));
  showPluginFailureToast("Workspace", new AppError("settings/shortcut-conflict", "private settings payload"));
  expect(payloads).toEqual([{ kind: "failure", pluginName: "Workspace", code: "settings/shortcut-conflict" }]);
  expect(JSON.stringify(payloads)).not.toContain("private settings payload");
});
