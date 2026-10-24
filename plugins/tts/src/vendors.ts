/**
 * Request shaping per TTS vendor — pure, so it is testable without network.
 * Every vendor resolves to one POST; all but MiMo answer with encoded audio
 * bytes directly (mp3 everywhere, since every webview decodes it), while MiMo
 * wraps base64 audio in a chat.completion (see extractJsonAudio).
 *
 * Settings persist as ONE object holding a value set per vendor
 * (`elevenlabsVoice`, `openaiModel`, `customEndpoint`, …) — switching the
 * provider switches to ITS values instead of dragging one shared voice/model
 * across engines. `normalizeSettings` resolves the active vendor's set into
 * the flat shape the request builders consume.
 */

export const VENDORS = ["elevenlabs", "fishaudio", "openai", "mimo", "custom"] as const;
export type Vendor = (typeof VENDORS)[number];

/** The active vendor's resolved configuration. */
export type TtsSettings = {
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

export type VoiceListRequest = {
  url: string;
  headers: Record<string, string>;
};

export type VoiceOption = { value: string; label: string };

export const VENDOR_LABELS: Record<Vendor, string> = {
  elevenlabs: "ElevenLabs",
  fishaudio: "Fish Audio",
  openai: "OpenAI",
  mimo: "MiMo",
  custom: "Custom endpoint",
};

/** The custom (often local) endpoint may be an open server — no key, no gate. */
export function vendorNeedsKey(vendor: Vendor): boolean {
  return vendor !== "custom";
}

/**
 * MiMo synthesizes through a chat completion: the user turn steers delivery,
 * the assistant turn is the text to speak. A neutral narration instruction
 * keeps reading aloud steady regardless of the passage's own tone.
 */
const MIMO_NARRATION_PROMPT =
  "Read the assistant message aloud exactly as written, in a natural, neutral narrator voice.";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSettings(raw: unknown): TtsSettings {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const vendor = VENDORS.includes(record.vendor as Vendor) ? (record.vendor as Vendor) : "custom";
  // Values are per-vendor keys; the pre-0.3 flat keys (voiceId/model/
  // endpoint) back-fill only while their per-vendor key has never been
  // written — the first settings edit persists every declared field and
  // retires the legacy object.
  const pick = (key: string, legacy: unknown) => (record[key] !== undefined ? text(record[key]) : text(legacy));
  return {
    vendor,
    voiceId: pick(`${vendor}Voice`, record.voiceId),
    model: pick(`${vendor}Model`, record.model),
    endpoint: vendor === "custom" ? pick("customEndpoint", record.endpoint) : "",
  };
}

export function buildSpeechRequest(settings: TtsSettings, apiKey: string | null, text: string): SpeechRequest {
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
    case "mimo":
      return {
        url: "https://api.xiaomimimo.com/v1/chat/completions",
        headers: { ...json, authorization: `Bearer ${apiKey ?? ""}` },
        body: JSON.stringify({
          model: settings.model || "mimo-v2.5-tts",
          messages: [
            { role: "user", content: MIMO_NARRATION_PROMPT },
            { role: "assistant", content: text },
          ],
          audio: { format: "mp3", voice: settings.voiceId || "mimo_default" },
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

// ─── Voice listings ──────────────────────────────────────────────────────────
//
// Where a vendor can enumerate its voices, the settings' voice select is
// dynamic and resolves through these. A vendor (or server) that cannot list
// yields null/[], and the host falls back to typing the voice by hand.

/**
 * The GETs that list a vendor's voices — empty when this vendor cannot list
 * them (OpenAI's set is static and declared in the manifest; a custom
 * endpoint can only be probed when it follows the `…/audio/speech`
 * convention). A custom endpoint yields TWO probes, merged by the caller:
 * the sibling `…/audio/voices` (Kokoro/LocalAI style), and `…/voices` next
 * to the API root — openai-edge-tts style, where `…/audio/voices` holds only
 * the OpenAI alias mapping while the full engine catalog (every Edge voice)
 * lives at `/v1/voices`. A probe the server doesn't implement just 404s and
 * drops out.
 */
export function buildVoiceListRequests(
  vendor: Vendor,
  settings: { endpoint?: string },
  apiKey: string | null,
): VoiceListRequest[] {
  switch (vendor) {
    case "elevenlabs":
      if (!apiKey) return [];
      return [
        {
          url: "https://api.elevenlabs.io/v1/voices",
          headers: { "xi-api-key": apiKey },
        },
      ];
    case "fishaudio":
      if (!apiKey) return [];
      return [
        {
          url: "https://api.fish.audio/model?self=true&page_size=100",
          headers: { authorization: `Bearer ${apiKey}` },
        },
      ];
    case "openai":
      return [];
    case "mimo":
      // Like OpenAI, MiMo's preset voices are a fixed catalog — declared
      // statically in the manifest, never enumerated over the wire.
      return [];
    case "custom": {
      const endpoint = text(settings.endpoint);
      const match = endpoint.match(/^(.*)\/audio\/speech\/?(?:[?#].*)?$/);
      if (!match) return [];
      const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
      return [
        { url: `${match[1]}/audio/voices`, headers },
        { url: `${match[1]}/voices`, headers },
      ];
    }
  }
}

function optionFrom(entry: unknown): VoiceOption | null {
  if (typeof entry === "string") {
    const value = entry.trim();
    return value ? { value, label: value } : null;
  }
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const value = text(record.voice_id) || text(record._id) || text(record.id) || text(record.name);
  if (!value) return null;
  const label = text(record.name) || text(record.title) || value;
  return { value, label };
}

/**
 * Voices from a listing response, shape-tolerantly: ElevenLabs wraps them in
 * `voices` as objects, Fish Audio pages models in `items`, and
 * OpenAI-compatible servers answer `{ voices: string[] }` (Kokoro) or
 * `{ data: [...] }`. Unusable payloads yield [] — the caller treats that as
 * "cannot list", never as an error.
 */
export function parseVoiceList(payload: unknown): VoiceOption[] {
  if (typeof payload !== "object" || payload === null) return [];
  const record = payload as Record<string, unknown>;
  const entries = [record.voices, record.items, record.data, record.models].find(Array.isArray);
  if (!entries) return [];
  const seen = new Set<string>();
  const options: VoiceOption[] = [];
  for (const entry of entries as unknown[]) {
    const option = optionFrom(entry);
    if (!option || seen.has(option.value)) continue;
    seen.add(option.value);
    options.push(option);
  }
  return options;
}

// ─── MiMo's JSON-bound audio ─────────────────────────────────────────────────
//
// Every vendor above answers the synthesis POST with the encoded audio bytes
// themselves. MiMo alone answers with a chat.completion whose audio rides
// base64-encoded in choices[0].message.audio.data — the caller must branch
// on the vendor before reading the body.

/** True when the vendor's synthesis response is JSON, not raw audio bytes. */
export function vendorReturnsJson(vendor: Vendor): boolean {
  return vendor === "mimo";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Bytes from a MiMo chat.completion payload; throws when no audio is present. */
export function extractJsonAudio(payload: unknown): ArrayBuffer {
  const choices = asRecord(payload)?.choices;
  const message = Array.isArray(choices) ? asRecord(choices[0])?.message : undefined;
  const encoded = asRecord(asRecord(message)?.audio)?.data;
  if (typeof encoded !== "string" || encoded.length === 0) throw new Error("no audio data");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
