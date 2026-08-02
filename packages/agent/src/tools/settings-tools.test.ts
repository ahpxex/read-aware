import { describe, expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { AgentSettingDescriptor } from "../settings";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildSettingsTools } from "./settings-tools";

function resultJson(result: AgentToolResult<unknown>): unknown {
  const content = result.content[0];
  if (!content || content.type !== "text")
    throw new Error("expected a text tool result");
  return JSON.parse(content.text);
}

function setting(
  settings: AgentSettingDescriptor[],
  path: string,
): AgentSettingDescriptor {
  const match = settings.find((candidate) => candidate.path === path);
  if (!match) throw new Error(`missing fixture setting: ${path}`);
  return match;
}

describe("settings tools", () => {
  test("reads one section as a generic host settings catalog", async () => {
    const { deps } = createInMemoryDeps();
    const tool = buildSettingsTools(deps).find(
      (candidate) => candidate.name === "get_settings",
    );
    if (!tool) throw new Error("get_settings was not registered");

    const result = resultJson(
      await tool.execute("call-1", { section: "reading" }),
    ) as {
      settings: {
        target: { kind: string };
        settings: AgentSettingDescriptor[];
        overrides: unknown[];
      };
    };

    expect(result.settings.target).toEqual({ kind: "global" });
    expect(
      result.settings.settings.every((entry) => entry.section === "reading"),
    ).toBe(true);
    expect(setting(result.settings.settings, "reading.theme")).toMatchObject({
      value: "warm",
      kind: "enum",
      writable: true,
      supportedTargets: ["global", "all-books", "book"],
    });
    expect(
      setting(result.settings.settings, "reading.fontSize").options,
    ).toContainEqual({
      value: "large",
      label: "large",
    });
  });

  test("updates unrelated preferences through the same path/value contract", async () => {
    const { deps, stores } = createInMemoryDeps();
    const tool = buildSettingsTools(deps).find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!tool) throw new Error("update_settings was not registered");

    const changes = [
      { path: "general.startView", value: "resume" },
      {
        path: "reading.fontSize",
        value: "large",
        target: { kind: "global" },
      },
      {
        path: "reading.readingMode",
        value: "scroll",
        target: { kind: "global" },
      },
      { path: "ai.preferences.followStreaming", value: true },
    ];
    const result = resultJson(await tool.execute("call-2", { changes }));

    expect(result).toMatchObject({ updated: true });
    expect(setting(stores.settings.settings, "general.startView").value).toBe(
      "resume",
    );
    expect(setting(stores.settings.settings, "reading.fontSize").value).toBe(
      "large",
    );
    expect(setting(stores.settings.settings, "reading.readingMode").value).toBe(
      "scroll",
    );
    expect(
      setting(stores.settings.settings, "ai.preferences.followStreaming").value,
    ).toBe(true);
  });

  test("preserves every generic value type through pi argument validation", () => {
    const { deps } = createInMemoryDeps();
    const tool = buildSettingsTools(deps).find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!tool) throw new Error("update_settings was not registered");
    const values = [null, true, 8_192, "large"];

    const validated = validateToolArguments(tool, {
      type: "toolCall",
      id: "call-value-types",
      name: tool.name,
      arguments: {
        changes: values.map((value, index) => ({
          path: `section.setting${index}`,
          value,
        })),
      },
    }) as { changes: Array<{ value: unknown }> };

    expect(validated.changes.map((change) => change.value)).toEqual(values);
  });

  test("keeps credentials and endpoint destinations outside the tool boundary", async () => {
    const { deps } = createInMemoryDeps();
    const tools = buildSettingsTools(deps);
    const getTool = tools.find(
      (candidate) => candidate.name === "get_settings",
    );
    const updateTool = tools.find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!getTool || !updateTool)
      throw new Error("settings tools were not registered");

    const catalog = resultJson(await getTool.execute("call-safe-read", {}));
    const serialized = JSON.stringify({
      catalog,
      schema: updateTool.parameters,
    });
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("customBaseUrl");
  });

  test("discovers and applies plugin choices without theme-specific tool fields", async () => {
    const { deps, stores } = createInMemoryDeps();
    const appearanceTheme = setting(
      stores.settings.settings,
      "appearance.theme",
    );
    appearanceTheme.options?.push({
      value: "plugin:editorial-themes:gutenberg",
      label: "Gutenberg",
      source: "plugin",
      pluginName: "Editorial Themes",
      polarity: "light",
    });
    const tools = buildSettingsTools(deps);
    const getTool = tools.find(
      (candidate) => candidate.name === "get_settings",
    );
    const updateTool = tools.find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!getTool || !updateTool)
      throw new Error("settings tools were not registered");

    const result = resultJson(
      await getTool.execute("call-theme-read", { section: "appearance" }),
    ) as { settings: { settings: AgentSettingDescriptor[] } };
    expect(
      setting(result.settings.settings, "appearance.theme").options,
    ).toContainEqual(
      expect.objectContaining({
        value: "plugin:editorial-themes:gutenberg",
        source: "plugin",
      }),
    );

    await updateTool.execute("call-theme-update", {
      changes: [
        {
          path: "appearance.theme",
          value: "plugin:editorial-themes:gutenberg",
        },
      ],
    });
    expect(setting(stores.settings.settings, "appearance.theme").value).toBe(
      "plugin:editorial-themes:gutenberg",
    );

    const schema = JSON.stringify(updateTool.parameters);
    expect(schema).toContain('"path"');
    expect(schema).not.toContain("appearance.theme");
  });

  test("validates book targets before delegating to the host registry", async () => {
    const { deps } = createInMemoryDeps({
      books: [{ id: "book-1", title: "The Book" }],
    });
    const tool = buildSettingsTools(deps).find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!tool) throw new Error("update_settings was not registered");

    await expect(
      tool.execute("call-missing-book", {
        changes: [
          {
            path: "reading.fontSize",
            value: "large",
            target: { kind: "book", bookId: "missing" },
          },
        ],
      }),
    ).rejects.toThrow("unknown book: missing");

    await expect(
      tool.execute("call-known-book", {
        changes: [
          {
            path: "reading.fontSize",
            value: "large",
            target: { kind: "book", bookId: "book-1" },
          },
        ],
      }),
    ).resolves.toBeDefined();
  });

  test("warns when a global write remains shadowed by scoped overrides", async () => {
    const { deps, stores } = createInMemoryDeps();
    stores.settings.overrides = [
      {
        target: { kind: "book", bookId: "book-1" },
        paths: ["reading.theme", "reading.fontSize"],
      },
    ];
    const tool = buildSettingsTools(deps).find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!tool) throw new Error("update_settings was not registered");

    const result = resultJson(
      await tool.execute("call-shadowed-global", {
        changes: [
          {
            path: "reading.theme",
            value: "dark",
            target: { kind: "global" },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      updated: true,
      warnings: [
        {
          path: "reading.theme",
          shadowedBy: [{ kind: "book", bookId: "book-1" }],
        },
      ],
    });
  });

  test("rejects an empty change list", async () => {
    const { deps } = createInMemoryDeps();
    const tool = buildSettingsTools(deps).find(
      (candidate) => candidate.name === "update_settings",
    );
    if (!tool) throw new Error("update_settings was not registered");

    await expect(tool.execute("call-3", { changes: [] })).rejects.toThrow(
      "at least one settings change is required",
    );
  });
});
