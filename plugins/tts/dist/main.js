// src/vendors.ts
var VENDORS = ["elevenlabs", "fishaudio", "openai", "custom"];
var VENDOR_LABELS = {
  elevenlabs: "ElevenLabs",
  fishaudio: "Fish Audio",
  openai: "OpenAI",
  custom: "Custom endpoint"
};
function vendorNeedsKey(vendor) {
  return vendor !== "custom";
}
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function normalizeSettings(raw) {
  const record = typeof raw === "object" && raw !== null ? raw : {};
  const vendor = VENDORS.includes(record.vendor) ? record.vendor : "custom";
  const pick = (key, legacy) => record[key] !== undefined ? text(record[key]) : text(legacy);
  return {
    vendor,
    voiceId: pick(`${vendor}Voice`, record.voiceId),
    model: pick(`${vendor}Model`, record.model),
    endpoint: vendor === "custom" ? pick("customEndpoint", record.endpoint) : ""
  };
}
function buildSpeechRequest(settings, apiKey, text2) {
  const json = { "content-type": "application/json" };
  switch (settings.vendor) {
    case "elevenlabs": {
      const voice = settings.voiceId || "21m00Tcm4TlvDq8ikWAM";
      return {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
        headers: { ...json, "xi-api-key": apiKey ?? "" },
        body: JSON.stringify({
          text: text2,
          model_id: settings.model || "eleven_multilingual_v2"
        })
      };
    }
    case "fishaudio":
      return {
        url: "https://api.fish.audio/v1/tts",
        headers: {
          ...json,
          authorization: `Bearer ${apiKey ?? ""}`,
          ...settings.model ? { model: settings.model } : {}
        },
        body: JSON.stringify({
          text: text2,
          format: "mp3",
          ...settings.voiceId ? { reference_id: settings.voiceId } : {}
        })
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/audio/speech",
        headers: { ...json, authorization: `Bearer ${apiKey ?? ""}` },
        body: JSON.stringify({
          model: settings.model || "tts-1",
          input: text2,
          voice: settings.voiceId || "alloy",
          response_format: "mp3"
        })
      };
    case "custom": {
      if (!settings.endpoint) {
        throw new Error("Set the custom endpoint URL in the plugin's settings");
      }
      return {
        url: settings.endpoint,
        headers: {
          ...json,
          ...apiKey ? { authorization: `Bearer ${apiKey}` } : {}
        },
        body: JSON.stringify({
          input: text2,
          response_format: "mp3",
          ...settings.model ? { model: settings.model } : {},
          ...settings.voiceId ? { voice: settings.voiceId } : {}
        })
      };
    }
  }
}
function buildVoiceListRequests(vendor, settings, apiKey) {
  switch (vendor) {
    case "elevenlabs":
      if (!apiKey)
        return [];
      return [
        {
          url: "https://api.elevenlabs.io/v1/voices",
          headers: { "xi-api-key": apiKey }
        }
      ];
    case "fishaudio":
      if (!apiKey)
        return [];
      return [
        {
          url: "https://api.fish.audio/model?self=true&page_size=100",
          headers: { authorization: `Bearer ${apiKey}` }
        }
      ];
    case "openai":
      return [];
    case "custom": {
      const endpoint = text(settings.endpoint);
      const match = endpoint.match(/^(.*)\/audio\/speech\/?(?:[?#].*)?$/);
      if (!match)
        return [];
      const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
      return [
        { url: `${match[1]}/audio/voices`, headers },
        { url: `${match[1]}/voices`, headers }
      ];
    }
  }
}
function optionFrom(entry) {
  if (typeof entry === "string") {
    const value2 = entry.trim();
    return value2 ? { value: value2, label: value2 } : null;
  }
  if (typeof entry !== "object" || entry === null)
    return null;
  const record = entry;
  const value = text(record.voice_id) || text(record._id) || text(record.id) || text(record.name);
  if (!value)
    return null;
  const label = text(record.name) || text(record.title) || value;
  return { value, label };
}
function parseVoiceList(payload) {
  if (typeof payload !== "object" || payload === null)
    return [];
  const record = payload;
  const entries = [record.voices, record.items, record.data, record.models].find(Array.isArray);
  if (!entries)
    return [];
  const seen = new Set;
  const options = [];
  for (const entry of entries) {
    const option = optionFrom(entry);
    if (!option || seen.has(option.value))
      continue;
    seen.add(option.value);
    options.push(option);
  }
  return options;
}

// src/index.ts
function readSettings(ctx) {
  return normalizeSettings(ctx.storage.get("settings"));
}
function secretName(vendor) {
  return `${vendor}-api-key`;
}
var voiceNameCache = null;
async function lookupVoiceName(ctx, network, settings) {
  const cacheKey = `${settings.vendor}\x00${settings.voiceId}\x00${settings.endpoint}`;
  if (voiceNameCache?.key === cacheKey)
    return voiceNameCache.name;
  const apiKey = await ctx.secrets.get(secretName(settings.vendor));
  const requests = buildVoiceListRequests(settings.vendor, { endpoint: settings.endpoint }, apiKey);
  for (const request of requests) {
    try {
      const response = await network.fetch(request.url, {
        headers: request.headers,
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok)
        continue;
      const match = parseVoiceList(await response.json()).find((option) => option.value === settings.voiceId);
      if (match && match.label !== match.value) {
        voiceNameCache = { key: cacheKey, name: match.label };
        return match.label;
      }
    } catch {}
  }
  return null;
}
async function voiceLabel(ctx, network, settings) {
  const vendor = VENDOR_LABELS[settings.vendor];
  let descriptor = settings.vendor === "custom" ? settings.voiceId || settings.model || "local" : settings.voiceId || settings.model || "default";
  if (settings.voiceId) {
    const name = await lookupVoiceName(ctx, network, settings);
    if (name)
      descriptor = name;
  }
  return `${vendor} · ${descriptor}`;
}
var DYNAMIC_VOICE_FIELDS = [
  { vendor: "elevenlabs", fieldId: "elevenlabsVoice" },
  { vendor: "fishaudio", fieldId: "fishaudioVoice" },
  { vendor: "custom", fieldId: "customVoice" }
];
var plugin = {
  activate(ctx) {
    const network = ctx.network;
    if (!network)
      return;
    ctx.audio.registerVoiceProvider({
      id: "voices",
      label: "TTS",
      listVoices: async () => [
        { id: "default", label: await voiceLabel(ctx, network, readSettings(ctx)) }
      ],
      synthesize: async ({ text: text2 }) => {
        const settings = readSettings(ctx);
        const apiKey = await ctx.secrets.get(secretName(settings.vendor));
        if (vendorNeedsKey(settings.vendor) && !apiKey) {
          throw new Error(`${VENDOR_LABELS[settings.vendor]} API key not set — open "TTS keys" from the shelf header`);
        }
        const request = buildSpeechRequest(settings, apiKey, text2);
        const response = await network.fetch(request.url, {
          method: "POST",
          headers: request.headers,
          body: request.body
        });
        if (!response.ok) {
          throw new Error(`${VENDOR_LABELS[settings.vendor]} returned ${response.status}`);
        }
        return await response.arrayBuffer();
      }
    });
    for (const { vendor, fieldId } of DYNAMIC_VOICE_FIELDS) {
      ctx.settings.provideOptions(fieldId, async (values) => {
        const endpoint = typeof values.customEndpoint === "string" ? values.customEndpoint : normalizeSettings({
          ...ctx.storage.get("settings") ?? {},
          vendor: "custom"
        }).endpoint;
        const apiKey = await ctx.secrets.get(secretName(vendor));
        const requests = buildVoiceListRequests(vendor, { endpoint }, apiKey);
        const listings = await Promise.all(requests.map(async (request) => {
          try {
            const response = await network.fetch(request.url, {
              headers: request.headers
            });
            if (!response.ok)
              return [];
            return parseVoiceList(await response.json());
          } catch {
            return [];
          }
        }));
        const seen = new Set;
        const voices = [];
        for (const option of listings.flat()) {
          if (seen.has(option.value))
            continue;
          seen.add(option.value);
          voices.push(option);
        }
        if (voices.length === 0)
          return [];
        return [{ value: "", label: "Default voice" }, ...voices];
      });
    }
  }
};
var src_default = plugin;
export {
  src_default as default
};
