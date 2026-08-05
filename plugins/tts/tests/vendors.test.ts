import { describe, expect, test } from "bun:test";
import { buildSpeechRequest, normalizeSettings } from "../src/vendors";

describe("normalizeSettings", () => {
  test("defends unknown vendors and non-string fields", () => {
    expect(normalizeSettings({ vendor: "evil", voiceId: 42 })).toEqual({
      vendor: "custom",
      voiceId: "",
      model: "",
      endpoint: "",
    });
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
