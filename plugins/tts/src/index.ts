/**
 * Universal read-aloud voices: one provider, many engines. The vendor,
 * voice, model, and endpoint come from the declarative settings (agent-
 * adjustable); API keys live in the encrypted secret store, entered through
 * the "TTS keys" shelf popup. The host asks `synthesize` for one sentence at
 * a time and owns playback, prefetch, and fallback.
 */
import type { PluginContext, PluginModule } from "@read-aware/plugin-types";
import {
  buildSpeechRequest,
  normalizeSettings,
  VENDOR_LABELS,
  vendorNeedsKey,
  type TtsSettings,
} from "./vendors";

function readSettings(ctx: PluginContext): TtsSettings {
  return normalizeSettings(ctx.storage.get("settings"));
}

function secretName(vendor: TtsSettings["vendor"]): string {
  return `${vendor}-api-key`;
}

function voiceLabel(settings: TtsSettings): string {
  const vendor = VENDOR_LABELS[settings.vendor];
  const descriptor =
    settings.vendor === "custom"
      ? settings.voiceId || settings.model || "local"
      : settings.voiceId || settings.model || "default";
  return `${vendor} · ${descriptor}`;
}

function keysFormView(ctx: PluginContext) {
  const settings = readSettings(ctx);
  const vendor = settings.vendor;
  return {
    kind: "form" as const,
    title: `API key — ${VENDOR_LABELS[vendor]}`,
    fields: [
      {
        kind: "text" as const,
        id: "apiKey",
        label: `${VENDOR_LABELS[vendor]} API key`,
        inputMode: "password" as const,
        placeholder: "Stored in the encrypted secret store",
        helperText:
          vendor === "custom"
            ? "Optional for local endpoints; sent as a Bearer token when set."
            : "Overwrites the stored key. Leave empty and submit to clear it.",
      },
    ],
    submitLabel: "Save",
    onSubmit: async (values: Record<string, string | number | boolean>) => {
      const key = String(values.apiKey ?? "").trim();
      if (key) await ctx.secrets.set(secretName(vendor), key);
      else await ctx.secrets.remove(secretName(vendor));
      return { toast: key ? "API key saved" : "API key cleared" };
    },
  };
}

const plugin: PluginModule = {
  activate(ctx) {
    const network = ctx.network;
    if (!network) return;

    ctx.audio.registerVoiceProvider({
      id: "voices",
      label: "TTS",
      listVoices: () => [{ id: "default", label: voiceLabel(readSettings(ctx)) }],
      synthesize: async ({ text }) => {
        const settings = readSettings(ctx);
        const apiKey = await ctx.secrets.get(secretName(settings.vendor));
        if (vendorNeedsKey(settings.vendor) && !apiKey) {
          throw new Error(
            `${VENDOR_LABELS[settings.vendor]} API key not set — open "TTS keys" from the shelf header`,
          );
        }
        const request = buildSpeechRequest(settings, apiKey, text);
        const response = await network.fetch(request.url, {
          method: "POST",
          headers: request.headers,
          body: request.body,
        });
        if (!response.ok) {
          throw new Error(
            `${VENDOR_LABELS[settings.vendor]} returned ${response.status}`,
          );
        }
        return await response.arrayBuffer();
      },
    });

    ctx.ui.registerHeaderAction({
      id: "keys",
      title: "TTS keys",
      icon: "speaker",
      surface: "shelf",
      view: () => keysFormView(ctx),
    });
  },
};

export default plugin;
