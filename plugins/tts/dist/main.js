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
function normalizeSettings(raw) {
  const record = typeof raw === "object" && raw !== null ? raw : {};
  const vendor = VENDORS.includes(record.vendor) ? record.vendor : "custom";
  const text = (value) => typeof value === "string" ? value.trim() : "";
  return {
    enabled: record.enabled === true,
    vendor,
    voiceId: text(record.voiceId),
    model: text(record.model),
    endpoint: text(record.endpoint)
  };
}
function buildSpeechRequest(settings, apiKey, text) {
  const json = { "content-type": "application/json" };
  switch (settings.vendor) {
    case "elevenlabs": {
      const voice = settings.voiceId || "21m00Tcm4TlvDq8ikWAM";
      return {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
        headers: { ...json, "xi-api-key": apiKey ?? "" },
        body: JSON.stringify({
          text,
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
          text,
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
          input: text,
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
          input: text,
          response_format: "mp3",
          ...settings.model ? { model: settings.model } : {},
          ...settings.voiceId ? { voice: settings.voiceId } : {}
        })
      };
    }
  }
}

// src/index.ts
function readSettings(ctx) {
  return normalizeSettings(ctx.storage.get("settings"));
}
function secretName(vendor) {
  return `${vendor}-api-key`;
}
function voiceLabel(settings) {
  const vendor = VENDOR_LABELS[settings.vendor];
  const descriptor = settings.vendor === "custom" ? settings.voiceId || settings.model || "local" : settings.voiceId || settings.model || "default";
  return `${vendor} · ${descriptor}`;
}
function keysFormView(ctx) {
  const settings = readSettings(ctx);
  const vendor = settings.vendor;
  return {
    kind: "form",
    title: `API key — ${VENDOR_LABELS[vendor]}`,
    fields: [
      {
        kind: "text",
        id: "apiKey",
        label: `${VENDOR_LABELS[vendor]} API key`,
        inputMode: "password",
        placeholder: "Stored in the encrypted secret store",
        helperText: vendor === "custom" ? "Optional for local endpoints; sent as a Bearer token when set." : "Overwrites the stored key. Leave empty and submit to clear it."
      }
    ],
    submitLabel: "Save",
    onSubmit: async (values) => {
      const key = String(values.apiKey ?? "").trim();
      if (key)
        await ctx.secrets.set(secretName(vendor), key);
      else
        await ctx.secrets.remove(secretName(vendor));
      return { toast: key ? "API key saved" : "API key cleared" };
    }
  };
}
var plugin = {
  activate(ctx) {
    const network = ctx.network;
    if (!network)
      return;
    ctx.audio.registerVoiceProvider({
      id: "voices",
      label: "TTS",
      listVoices: () => {
        const settings = readSettings(ctx);
        return settings.enabled ? [{ id: "default", label: voiceLabel(settings) }] : [];
      },
      synthesize: async ({ text }) => {
        const settings = readSettings(ctx);
        const apiKey = await ctx.secrets.get(secretName(settings.vendor));
        if (vendorNeedsKey(settings.vendor) && !apiKey) {
          throw new Error(`${VENDOR_LABELS[settings.vendor]} API key not set — open "TTS keys" from the shelf header`);
        }
        const request = buildSpeechRequest(settings, apiKey, text);
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
    ctx.ui.registerHeaderAction({
      id: "keys",
      title: "TTS keys",
      icon: "speaker",
      surface: "shelf",
      view: () => keysFormView(ctx)
    });
  }
};
var src_default = plugin;
export {
  src_default as default
};
