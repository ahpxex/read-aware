/**
 * Universal read-aloud voices: one provider, many engines. The vendor and its
 * per-vendor voice/model/endpoint come from the declarative settings (agent-
 * adjustable); API keys live in the encrypted secret store, entered through
 * the "TTS keys" shelf popup. Enabling the plugin IS opting in — its voice
 * registers unconditionally and read-aloud adopts it (the host still falls
 * back to the system voice whenever a synthesis call fails). The host asks
 * `synthesize` for one sentence at a time and owns playback, prefetch, and
 * fallback.
 */
import type { PluginContext, PluginModule } from "@read-aware/plugin-types";
import {
  buildSpeechRequest,
  buildVoiceListRequests,
  normalizeSettings,
  parseVoiceList,
  VENDOR_LABELS,
  vendorNeedsKey,
  type TtsSettings,
  type Vendor,
  type VoiceOption,
} from "./vendors";

function readSettings(ctx: PluginContext): TtsSettings {
  return normalizeSettings(ctx.storage.get("settings"));
}

function secretName(vendor: Vendor): string {
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

/** The settings fields whose voice list this plugin can enumerate at runtime. */
const DYNAMIC_VOICE_FIELDS: ReadonlyArray<{ vendor: Vendor; fieldId: string }> = [
  { vendor: "elevenlabs", fieldId: "elevenlabsVoice" },
  { vendor: "fishaudio", fieldId: "fishaudioVoice" },
  { vendor: "custom", fieldId: "customVoice" },
];

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

    // Voice pickers: list what the vendor can enumerate (the account's
    // ElevenLabs voices, Fish Audio models, a Kokoro-style endpoint's
    // voices). An empty result means "cannot list" and the host offers a
    // text input instead — listing is a convenience, never a gate.
    for (const { vendor, fieldId } of DYNAMIC_VOICE_FIELDS) {
      ctx.settings.provideOptions(fieldId, async (values) => {
        // Prefer the form's live endpoint value — the list should follow
        // what the user is typing, not what was last persisted.
        const endpoint =
          typeof values.customEndpoint === "string"
            ? values.customEndpoint
            : normalizeSettings({
                ...(ctx.storage.get<Record<string, unknown>>("settings") ?? {}),
                vendor: "custom",
              }).endpoint;
        const apiKey = await ctx.secrets.get(secretName(vendor));
        const requests = buildVoiceListRequests(vendor, { endpoint }, apiKey);
        const listings = await Promise.all(
          requests.map(async (request) => {
            try {
              const response = await network.fetch(request.url, {
                headers: request.headers,
              });
              if (!response.ok) return [];
              return parseVoiceList(await response.json());
            } catch {
              return [];
            }
          }),
        );
        const seen = new Set<string>();
        const voices: VoiceOption[] = [];
        for (const option of listings.flat()) {
          if (seen.has(option.value)) continue;
          seen.add(option.value);
          voices.push(option);
        }
        if (voices.length === 0) return [];
        return [{ value: "", label: "Default voice" }, ...voices];
      });
    }

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
