import { describe, expect, test } from "bun:test";
import {
  buildSpeechRequest,
  buildVoiceListRequest,
  normalizeSettings,
  parseVoiceList,
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
    expect(
      normalizeSettings({ ...legacy, customVoice: "", customModel: "" }).voiceId,
    ).toBe("");
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
      buildSpeechRequest(
        { vendor: "openai", voiceId: "", model: "", endpoint: "" },
        "KEY",
        "Hi.",
      ).body,
    );
    expect(body).toEqual({
      model: "tts-1",
      input: "Hi.",
      voice: "alloy",
      response_format: "mp3",
    });
  });

  test("custom: requires an endpoint, bearer only when a key exists", () => {
    expect(() =>
      buildSpeechRequest(
        { vendor: "custom", voiceId: "", model: "", endpoint: "" },
        null,
        "Hi.",
      ),
    ).toThrow(/endpoint/);
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
});

describe("buildVoiceListRequest", () => {
  test("keyed vendors list only once a key exists", () => {
    expect(buildVoiceListRequest("elevenlabs", {}, null)).toBeNull();
    expect(buildVoiceListRequest("fishaudio", {}, null)).toBeNull();
    expect(buildVoiceListRequest("elevenlabs", {}, "KEY")).toEqual({
      url: "https://api.elevenlabs.io/v1/voices",
      headers: { "xi-api-key": "KEY" },
    });
    expect(buildVoiceListRequest("fishaudio", {}, "KEY")?.headers.authorization).toBe(
      "Bearer KEY",
    );
  });

  test("openai has no listing — its voices are declared statically", () => {
    expect(buildVoiceListRequest("openai", {}, "KEY")).toBeNull();
  });

  test("custom probes the sibling voices route of an …/audio/speech URL", () => {
    expect(
      buildVoiceListRequest(
        "custom",
        { endpoint: "http://127.0.0.1:8880/v1/audio/speech" },
        null,
      ),
    ).toEqual({ url: "http://127.0.0.1:8880/v1/audio/voices", headers: {} });
    expect(
      buildVoiceListRequest(
        "custom",
        { endpoint: "https://tts.local/v1/audio/speech?fmt=mp3" },
        "KEY",
      ),
    ).toEqual({
      url: "https://tts.local/v1/audio/voices",
      headers: { authorization: "Bearer KEY" },
    });
    // Off-convention endpoints cannot be probed — no request, text fallback.
    expect(
      buildVoiceListRequest("custom", { endpoint: "https://tts.local/speak" }, null),
    ).toBeNull();
    expect(buildVoiceListRequest("custom", {}, null)).toBeNull();
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
    expect(
      parseVoiceList({ total: 1, items: [{ _id: "m-1", title: "My Voice" }] }),
    ).toEqual([{ value: "m-1", label: "My Voice" }]);
  });

  test("unusable payloads yield an empty list, never throw", () => {
    expect(parseVoiceList(null)).toEqual([]);
    expect(parseVoiceList("nope")).toEqual([]);
    expect(parseVoiceList({ voices: "nope" })).toEqual([]);
    expect(parseVoiceList({ data: [42, {}] })).toEqual([]);
  });
});
