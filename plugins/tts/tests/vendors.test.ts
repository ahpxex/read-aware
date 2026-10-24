import { describe, expect, test } from "bun:test";
import {
  buildSpeechRequest,
  buildVoiceListRequests,
  extractJsonAudio,
  normalizeSettings,
  parseVoiceList,
  vendorReturnsJson,
} from "../src/vendors";

describe("normalizeSettings", () => {
  test("defends unknown vendors and non-string fields", () => {
    expect(normalizeSettings({ vendor: "evil", customVoice: 42 })).toEqual({
      vendor: "custom",
      voiceId: "",
      model: "",
      endpoint: "",
    });
  });

  test("resolves the active vendor's own value set", () => {
    const stored = {
      vendor: "elevenlabs",
      elevenlabsVoice: "rachel-id",
      elevenlabsModel: "eleven_turbo_v2_5",
      openaiVoice: "nova",
      customEndpoint: "http://127.0.0.1:8880/v1/audio/speech",
    };
    expect(normalizeSettings(stored)).toEqual({
      vendor: "elevenlabs",
      voiceId: "rachel-id",
      model: "eleven_turbo_v2_5",
      endpoint: "",
    });
    expect(normalizeSettings({ ...stored, vendor: "openai" })).toEqual({
      vendor: "openai",
      voiceId: "nova",
      model: "",
      endpoint: "",
    });
    expect(normalizeSettings({ ...stored, vendor: "custom" })).toEqual({
      vendor: "custom",
      voiceId: "",
      model: "",
      endpoint: "http://127.0.0.1:8880/v1/audio/speech",
    });
    expect(normalizeSettings({ ...stored, vendor: "mimo", mimoVoice: "冰糖", mimoModel: "mimo-v2.5-tts" })).toEqual({
      vendor: "mimo",
      voiceId: "冰糖",
      model: "mimo-v2.5-tts",
      endpoint: "",
    });
  });

  test("falls back to pre-0.3 flat keys until per-vendor keys are written", () => {
    const legacy = {
      vendor: "custom",
      voiceId: "af_bella",
      model: "kokoro",
      endpoint: "http://127.0.0.1:8880/v1/audio/speech",
    };
    expect(normalizeSettings(legacy)).toEqual({
      vendor: "custom",
      voiceId: "af_bella",
      model: "kokoro",
      endpoint: "http://127.0.0.1:8880/v1/audio/speech",
    });
    // A written per-vendor key wins even when empty — the first edit through
    // the new form persists every declared field and retires the legacy keys.
    expect(normalizeSettings({ ...legacy, customVoice: "", customModel: "" }).voiceId).toBe("");
  });
});

describe("buildSpeechRequest", () => {
  test("elevenlabs: voice in path, key in header, model in body", () => {
    const request = buildSpeechRequest(
      { vendor: "elevenlabs", voiceId: "abc", model: "", endpoint: "" },
      "KEY",
      "Hello.",
    );
    expect(request.url).toContain("/text-to-speech/abc");
    expect(request.headers["xi-api-key"]).toBe("KEY");
    expect(JSON.parse(request.body).model_id).toBe("eleven_multilingual_v2");
  });

  test("fishaudio: bearer auth, reference id only when set", () => {
    const request = buildSpeechRequest(
      { vendor: "fishaudio", voiceId: "", model: "speech-02", endpoint: "" },
      "KEY",
      "Hello.",
    );
    expect(request.headers.authorization).toBe("Bearer KEY");
    expect(request.headers.model).toBe("speech-02");
    expect(JSON.parse(request.body)).not.toHaveProperty("reference_id");
  });

  test("openai: standard speech shape with defaults", () => {
    const body = JSON.parse(
      buildSpeechRequest({ vendor: "openai", voiceId: "", model: "", endpoint: "" }, "KEY", "Hi.").body,
    );
    expect(body).toEqual({
      model: "tts-1",
      input: "Hi.",
      voice: "alloy",
      response_format: "mp3",
    });
  });

  test("custom: requires an endpoint, bearer only when a key exists", () => {
    expect(() => buildSpeechRequest({ vendor: "custom", voiceId: "", model: "", endpoint: "" }, null, "Hi.")).toThrow(
      /endpoint/,
    );
    const request = buildSpeechRequest(
      { vendor: "custom", voiceId: "v", model: "kokoro", endpoint: "http://127.0.0.1:8880/v1/audio/speech" },
      null,
      "Hi.",
    );
    expect(request.headers).not.toHaveProperty("authorization");
    expect(JSON.parse(request.body)).toEqual({
      input: "Hi.",
      response_format: "mp3",
      model: "kokoro",
      voice: "v",
    });
  });

  test("mimo: chat-completion shape with the text as the assistant turn", () => {
    const request = buildSpeechRequest({ vendor: "mimo", voiceId: "", model: "", endpoint: "" }, "KEY", "你好。");
    expect(request.url).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer KEY");
    const body = JSON.parse(request.body);
    expect(body.model).toBe("mimo-v2.5-tts");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[1]).toEqual({ role: "assistant", content: "你好。" });
    expect(body.audio).toEqual({ format: "mp3", voice: "mimo_default" });
  });

  test("mimo: preset voice ids (Chinese names) pass through untouched", () => {
    const body = JSON.parse(
      buildSpeechRequest({ vendor: "mimo", voiceId: "冰糖", model: "", endpoint: "" }, "KEY", "Hi.").body,
    );
    expect(body.audio.voice).toBe("冰糖");
  });
});

describe("buildVoiceListRequests", () => {
  test("keyed vendors list only once a key exists", () => {
    expect(buildVoiceListRequests("elevenlabs", {}, null)).toEqual([]);
    expect(buildVoiceListRequests("fishaudio", {}, null)).toEqual([]);
    expect(buildVoiceListRequests("elevenlabs", {}, "KEY")).toEqual([
      {
        url: "https://api.elevenlabs.io/v1/voices",
        headers: { "xi-api-key": "KEY" },
      },
    ]);
    expect(buildVoiceListRequests("fishaudio", {}, "KEY")[0]?.headers.authorization).toBe("Bearer KEY");
  });

  test("openai has no listing — its voices are declared statically", () => {
    expect(buildVoiceListRequests("openai", {}, "KEY")).toEqual([]);
  });

  test("mimo has no listing — its preset voices are declared statically", () => {
    expect(buildVoiceListRequests("mimo", {}, "KEY")).toEqual([]);
  });

  test("custom probes both voices routes around an …/audio/speech URL", () => {
    expect(buildVoiceListRequests("custom", { endpoint: "http://127.0.0.1:5050/v1/audio/speech" }, null)).toEqual([
      { url: "http://127.0.0.1:5050/v1/audio/voices", headers: {} },
      { url: "http://127.0.0.1:5050/v1/voices", headers: {} },
    ]);
    expect(buildVoiceListRequests("custom", { endpoint: "https://tts.local/v1/audio/speech?fmt=mp3" }, "KEY")).toEqual([
      { url: "https://tts.local/v1/audio/voices", headers: { authorization: "Bearer KEY" } },
      { url: "https://tts.local/v1/voices", headers: { authorization: "Bearer KEY" } },
    ]);
    // Off-convention endpoints cannot be probed — no requests, text fallback.
    expect(buildVoiceListRequests("custom", { endpoint: "https://tts.local/speak" }, null)).toEqual([]);
    expect(buildVoiceListRequests("custom", {}, null)).toEqual([]);
  });
});

describe("parseVoiceList", () => {
  test("kokoro-style string arrays", () => {
    expect(parseVoiceList({ voices: ["af_bella", "am_adam", " ", "af_bella"] })).toEqual([
      { value: "af_bella", label: "af_bella" },
      { value: "am_adam", label: "am_adam" },
    ]);
  });

  test("elevenlabs voice objects use id as value, name as label", () => {
    expect(
      parseVoiceList({
        voices: [
          { voice_id: "21m00", name: "Rachel" },
          { voice_id: "abc", name: "" },
        ],
      }),
    ).toEqual([
      { value: "21m00", label: "Rachel" },
      { value: "abc", label: "abc" },
    ]);
  });

  test("fishaudio model pages use _id and title", () => {
    expect(parseVoiceList({ total: 1, items: [{ _id: "m-1", title: "My Voice" }] })).toEqual([
      { value: "m-1", label: "My Voice" },
    ]);
  });

  test("edge-tts full catalog entries carry only a name", () => {
    expect(
      parseVoiceList({
        voices: [{ name: "zh-CN-XiaoxiaoNeural", gender: "Female", language: "zh-CN" }],
      }),
    ).toEqual([{ value: "zh-CN-XiaoxiaoNeural", label: "zh-CN-XiaoxiaoNeural" }]);
  });

  test("unusable payloads yield an empty list, never throw", () => {
    expect(parseVoiceList(null)).toEqual([]);
    expect(parseVoiceList("nope")).toEqual([]);
    expect(parseVoiceList({ voices: "nope" })).toEqual([]);
    expect(parseVoiceList({ data: [42, {}] })).toEqual([]);
  });
});

describe("MiMo JSON audio", () => {
  test("only MiMo answers with JSON", () => {
    for (const vendor of ["elevenlabs", "fishaudio", "openai", "custom"] as const) {
      expect(vendorReturnsJson(vendor)).toBe(false);
    }
    expect(vendorReturnsJson("mimo")).toBe(true);
  });

  test("decodes the base64 audio out of a chat.completion", () => {
    const payload = {
      choices: [
        {
          message: {
            role: "assistant",
            audio: { id: "a1", data: "AAECAwQF", expires_at: null, transcript: null },
          },
        },
      ],
      object: "chat.completion",
    };
    const bytes = new Uint8Array(extractJsonAudio(payload));
    expect(Array.from(bytes)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("payloads without usable audio throw", () => {
    expect(() => extractJsonAudio(null)).toThrow();
    expect(() => extractJsonAudio({})).toThrow();
    expect(() => extractJsonAudio({ choices: [] })).toThrow();
    expect(() => extractJsonAudio({ choices: [{ message: { audio: { data: 42 } } }] })).toThrow();
    expect(() => extractJsonAudio({ choices: [{ message: { audio: { data: "" } } }] })).toThrow();
  });
});
