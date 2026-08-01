import { describe, expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildSettingsTools } from "./settings-tools";

function resultJson(result: AgentToolResult<unknown>): unknown {
  const content = result.content[0];
  if (!content || content.type !== "text") throw new Error("expected a text tool result");
  return JSON.parse(content.text);
}

describe("settings tools", () => {
  test("reads one sanitized settings section", async () => {
    const { deps } = createInMemoryDeps();
    const tool = buildSettingsTools(deps).find((candidate) => candidate.name === "get_settings");
    if (!tool) throw new Error("get_settings was not registered");

    const result = resultJson(await tool.execute("call-1", { section: "reading" }));
    expect(result).toEqual({
      settings: {
        reading: {
          theme: "warm",
          availableThemes: [
            { value: "auto", label: "Automatic", source: "builtin" },
            { value: "light", label: "Light", source: "builtin", polarity: "light" },
            { value: "warm", label: "Warm", source: "builtin", polarity: "light" },
            { value: "dark", label: "Dark", source: "builtin", polarity: "dark" },
          ],
          fontFamily: "curated:inter",
          fontSize: "medium",
          fontWeight: "regular",
          lineSpacing: "comfortable",
          paragraphSpacing: "normal",
          pageMargins: "wide",
          readingMode: "paginated-double",
        },
      },
    });
  });

  test("updates multiple ordinary preferences through the host port", async () => {
    const { deps, stores } = createInMemoryDeps();
    const tool = buildSettingsTools(deps).find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!tool) throw new Error("update_settings was not registered");

    const result = resultJson(
      await tool.execute("call-2", {
        changes: {
          general: { startView: "resume" },
          reading: { fontSize: "large", readingMode: "scroll" },
          ai: { preferences: { followStreaming: true } },
        },
      }),
    );

    expect(result).toMatchObject({ updated: true, changed: ["settings"] });
    expect(stores.settings.general.startView).toBe("resume");
    expect(stores.settings.reading).toMatchObject({
      fontSize: "large",
      readingMode: "scroll",
    });
    expect(stores.settings.ai.preferences.followStreaming).toBe(true);
  });

  test("does not put credential routing fields in the mutation schema", () => {
    const { deps } = createInMemoryDeps();
    const tool = buildSettingsTools(deps).find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!tool) throw new Error("update_settings was not registered");

    const schema = JSON.stringify(tool.parameters);
    expect(schema).not.toContain("apiKey");
    expect(schema).not.toContain("customBaseUrl");
    expect(schema).not.toContain('"provider"');
  });

  test("discovers and applies plugin theme refs instead of hard-coding built-ins", async () => {
    const { deps, stores } = createInMemoryDeps();
    stores.settings.appearance.availableThemes.push({
      value: "plugin:editorial-themes:gutenberg",
      label: "Gutenberg",
      source: "plugin",
      pluginName: "Editorial Themes",
      polarity: "light",
    });
    const tools = buildSettingsTools(deps);
    const getTool = tools.find((candidate) => candidate.name === "get_settings");
    const updateTool = tools.find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!getTool || !updateTool) throw new Error("settings tools were not registered");

    const result = resultJson(
      await getTool.execute("call-theme-read", { section: "appearance" }),
    );
    expect(result).toMatchObject({
      settings: {
        appearance: {
          availableThemes: [
            {},
            {},
            {},
            { value: "plugin:editorial-themes:gutenberg", source: "plugin" },
          ],
        },
      },
    });

    await updateTool.execute("call-theme-update", {
      changes: {
        appearance: { theme: "plugin:editorial-themes:gutenberg" },
      },
    });
    expect(stores.settings.appearance.theme).toBe(
      "plugin:editorial-themes:gutenberg",
    );

    const schema = JSON.stringify(updateTool.parameters);
    expect(schema).toContain("plugin:[a-z0-9]");
    expect(updateTool.description).toContain("availableThemes");
  });

  test("rejects an empty patch", async () => {
    const { deps } = createInMemoryDeps();
    const tool = buildSettingsTools(deps).find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!tool) throw new Error("update_settings was not registered");

    await expect(tool.execute("call-3", { changes: { reading: {} } })).rejects.toThrow(
      "at least one settings change is required",
    );
  });
});
