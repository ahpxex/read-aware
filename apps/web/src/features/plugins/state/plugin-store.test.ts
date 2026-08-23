import { describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import type { RegisteredVoiceProvider } from "../lib/plugin-types";
import {
  registerVoiceProviderContribution,
  updateVoiceProviderVoices,
  voiceProvidersAtom,
} from "./plugin-store";

function provider(version: string): RegisteredVoiceProvider {
  return {
    id: "voice",
    key: "sample:voice",
    pluginId: "sample",
    pluginName: "Sample",
    label: "Voice",
    voices: [{ id: version, label: version }],
    listVoices: () => [],
    synthesize: async () => new Uint8Array(),
  };
}

describe("plugin contribution generations", () => {
  test("a retired voice provider cannot overwrite its replacement", () => {
    const store = getDefaultStore();
    const previous = provider("v1");
    const next = provider("v2");
    const previousDisposable = registerVoiceProviderContribution(previous);
    const nextDisposable = registerVoiceProviderContribution(next);

    expect(updateVoiceProviderVoices(next.key, [{ id: "stale", label: "Stale" }], previous))
      .toBeNull();
    expect(store.get(voiceProvidersAtom)[0]?.voices[0]?.id).toBe("v2");

    const replacement = updateVoiceProviderVoices(
      next.key,
      [{ id: "fresh", label: "Fresh" }],
      next,
    );
    expect(replacement?.voices[0]?.id).toBe("fresh");
    expect(store.get(voiceProvidersAtom)[0]?.voices[0]?.id).toBe("fresh");

    previousDisposable.dispose();
    nextDisposable.dispose();
  });
});
