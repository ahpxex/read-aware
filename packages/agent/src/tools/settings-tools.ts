import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { RuntimeDeps } from "../ports";
import type {
  AgentSettingsPatch,
  AgentSettingsSection,
} from "../settings";
import { textResult } from "./tool-result";

const sectionSchema = Type.Union([
  Type.Literal("general"),
  Type.Literal("appearance"),
  Type.Literal("reading"),
  Type.Literal("ai"),
]);

const thinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);

const pluginThemeRefSchema = Type.String({
  pattern:
    "^plugin:[a-z0-9][a-z0-9-]{0,63}:[a-z0-9][a-z0-9-]{0,63}$",
  description:
    "An enabled plugin theme ref listed in the matching availableThemes array from get_settings.",
});

const featurePatchSchema = Type.Object(
  {
    explainSelection: Type.Optional(Type.Boolean()),
    defineTerm: Type.Optional(Type.Boolean()),
    translate: Type.Optional(Type.Boolean()),
    summarizeChapter: Type.Optional(Type.Boolean()),
    askConversation: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const settingsPatchSchema = Type.Object(
  {
    general: Type.Optional(
      Type.Object(
        {
          startView: Type.Optional(
            Type.Union([Type.Literal("shelf"), Type.Literal("resume")]),
          ),
          language: Type.Optional(
            Type.Union([
              Type.Literal("en"),
              Type.Literal("zh-Hans"),
              Type.Literal("zh-Hant"),
              Type.Literal("ja"),
              Type.Literal("fr"),
              Type.Literal("de"),
              Type.Literal("ru"),
              Type.Literal("es"),
            ]),
          ),
          crashReports: Type.Optional(Type.Boolean()),
          launchAtStartup: Type.Optional(Type.Boolean()),
          fileAssociations: Type.Optional(Type.Boolean()),
          autoUpdate: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    appearance: Type.Optional(
      Type.Object(
        {
          theme: Type.Optional(
            Type.Union([
              Type.Literal("system"),
              Type.Literal("light"),
              Type.Literal("dark"),
              pluginThemeRefSchema,
            ]),
          ),
          motion: Type.Optional(
            Type.Union([Type.Literal("system"), Type.Literal("reduced")]),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    reading: Type.Optional(
      Type.Object(
        {
          theme: Type.Optional(
            Type.Union([
              Type.Literal("auto"),
              Type.Literal("light"),
              Type.Literal("warm"),
              Type.Literal("dark"),
              pluginThemeRefSchema,
            ]),
          ),
          fontFamily: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                "A curated font (curated:inter, curated:atkinson, curated:literata, curated:lora, curated:lxgw) or a system font as system:<family>.",
            }),
          ),
          fontSize: Type.Optional(
            Type.Union([
              Type.Literal("xx-small"),
              Type.Literal("x-small"),
              Type.Literal("small"),
              Type.Literal("medium"),
              Type.Literal("large"),
              Type.Literal("x-large"),
              Type.Literal("xx-large"),
              Type.Literal("xxx-large"),
            ]),
          ),
          fontWeight: Type.Optional(
            Type.Union([
              Type.Literal("light"),
              Type.Literal("regular"),
              Type.Literal("medium"),
              Type.Literal("bold"),
            ]),
          ),
          lineSpacing: Type.Optional(
            Type.Union([
              Type.Literal("compact"),
              Type.Literal("comfortable"),
              Type.Literal("relaxed"),
            ]),
          ),
          paragraphSpacing: Type.Optional(
            Type.Union([
              Type.Literal("tight"),
              Type.Literal("normal"),
              Type.Literal("loose"),
            ]),
          ),
          pageMargins: Type.Optional(
            Type.Union([
              Type.Literal("narrow"),
              Type.Literal("medium"),
              Type.Literal("wide"),
            ]),
          ),
          readingMode: Type.Optional(
            Type.Union([
              Type.Literal("scroll"),
              Type.Literal("paginated-single"),
              Type.Literal("paginated-double"),
            ]),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    ai: Type.Optional(
      Type.Object(
        {
          preferences: Type.Optional(
            Type.Object(
              {
                features: Type.Optional(featurePatchSchema),
                buildMemory: Type.Optional(Type.Boolean()),
                sendHighlightedText: Type.Optional(Type.Boolean()),
                sendSurroundingContext: Type.Optional(Type.Boolean()),
                localOnly: Type.Optional(Type.Boolean()),
                followStreaming: Type.Optional(Type.Boolean()),
              },
              { additionalProperties: false },
            ),
          ),
          connection: Type.Optional(
            Type.Object(
              {
                primaryModel: Type.Optional(Type.String({ minLength: 1 })),
                fastModel: Type.Optional(
                  Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
                ),
                thinkingLevel: Type.Optional(thinkingLevelSchema),
                fastThinkingLevel: Type.Optional(thinkingLevelSchema),
                customApi: Type.Optional(
                  Type.Union([
                    Type.Literal("openai-completions"),
                    Type.Literal("openai-responses"),
                  ]),
                ),
                customSupportsThinking: Type.Optional(Type.Boolean()),
                customMaxOutputTokens: Type.Optional(
                  Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
                ),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

function hasLeaf(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const children = Object.values(value);
  return children.length > 0 && children.some(hasLeaf);
}

export function buildSettingsTools(deps: RuntimeDeps): AgentTool[] {
  const getSettings: AgentTool = {
    name: "get_settings",
    label: "Read settings",
    description:
      "Read the user's current editable app preferences, optionally for one section. Theme sections include availableThemes with every built-in and currently enabled plugin theme value accepted by update_settings. The result is sanitized: API keys and Custom provider endpoint values are never exposed.",
    parameters: Type.Object(
      {
        section: Type.Optional(sectionSchema),
      },
      { additionalProperties: false },
    ),
    execute: async (_id, params) => {
      const { section } = params as { section?: AgentSettingsSection };
      const settings = await deps.settings.getSettings();
      if (!section) return textResult({ settings });
      return textResult({ settings: { [section]: settings[section] } });
    },
  };

  const updateSettings: AgentTool = {
    name: "update_settings",
    label: "Update settings",
    description:
      "Update ordinary app preferences only when the user explicitly asks. Changes apply immediately. For plugin themes, first read the matching section with get_settings and copy its availableThemes value exactly. This cannot access or change API keys, providers, Custom endpoint destinations, data reset/restore, plugin lifecycle, menus, or shortcuts. fastThinkingLevel is valid only with a separate Fast model; set fastModel to null to make Fast follow Primary.",
    parameters: Type.Object(
      {
        changes: settingsPatchSchema,
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { changes } = params as { changes: AgentSettingsPatch };
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || !hasLeaf(changes)) {
        throw new Error("at least one settings change is required");
      }
      const result = await deps.settings.updateSettings(changes);
      return textResult({ updated: result.changed.length > 0, ...result });
    },
  };

  return [getSettings, updateSettings];
}
