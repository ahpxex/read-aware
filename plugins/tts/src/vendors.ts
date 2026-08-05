/**
 * Request shaping per TTS vendor — pure, so it is testable without network.
 * Every vendor resolves to one POST returning encoded audio bytes; mp3 is
 * requested everywhere since every webview decodes it.
 */

export const VENDORS = ["elevenlabs", "fishaudio", "openai", "custom"] as const;
export type Vendor = (typeof VENDORS)[number];

export type TtsSettings = {
  /** Off by default: the voice registers (and read-aloud adopts it) only
   *  once the user flips this in the plugin's settings. */
  enabled: boolean;
  vendor: Vendor;
  voiceId: string;
  model: string;
  endpoint: string;
};

export type SpeechRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

export const VENDOR_LABELS: Record<Vendor, string> = {
  elevenlabs: "ElevenLabs",
  fishaudio: "Fish Audio",
  openai: "OpenAI",
  custom: "Custom endpoint",
};

/** The custom (often local) endpoint may be an open server — no key, no gate. */
export function vendorNeedsKey(vendor: Vendor): boolean {
  return vendor !== "custom";
}

export function normalizeSettings(raw: unknown): TtsSettings {
  const record =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const vendor = VENDORS.includes(record.vendor as Vendor)
    ? (record.vendor as Vendor)
    : "custom";
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return {
    enabled: record.enabled === true,
    vendor,
    voiceId: text(record.voiceId),
    model: text(record.model),
    endpoint: text(record.endpoint),
  };
}

export function buildSpeechRequest(
  settings: TtsSettings,
  apiKey: string | null,
  text: string,
): SpeechRequest {
  const json = { "content-type": "application/json" };
  switch (settings.vendor) {
    case "elevenlabs": {
      const voice = settings.voiceId || "21m00Tcm4TlvDq8ikWAM";
      return {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
        headers: { ...json, "xi-api-key": apiKey ?? "" },
        body: JSON.stringify({
          text,
          model_id: settings.model || "eleven_multilingual_v2",
        }),
      };
    }
    case "fishaudio":
      return {
        url: "https://api.fish.audio/v1/tts",
        headers: {
          ...json,
          authorization: `Bearer ${apiKey ?? ""}`,
          ...(settings.model ? { model: settings.model } : {}),
        },
        body: JSON.stringify({
          text,
          format: "mp3",
          ...(settings.voiceId ? { reference_id: settings.voiceId } : {}),
        }),
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/audio/speech",
        headers: { ...json, authorization: `Bearer ${apiKey ?? ""}` },
        body: JSON.stringify({
          model: settings.model || "tts-1",
          input: text,
          voice: settings.voiceId || "alloy",
          response_format: "mp3",
        }),
      };
    case "custom": {
      if (!settings.endpoint) {
        throw new Error("Set the custom endpoint URL in the plugin's settings");
      }
      return {
        url: settings.endpoint,
        headers: {
          ...json,
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          input: text,
          response_format: "mp3",
          ...(settings.model ? { model: settings.model } : {}),
          ...(settings.voiceId ? { voice: settings.voiceId } : {}),
        }),
      };
    }
  }
}
