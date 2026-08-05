/**
 * Which voice read-aloud speaks with: a registered plugin voice when one
 * exists, the system voice otherwise. There is deliberately NO host-side
 * picker — enabling a voice-provider plugin IS the choice, and which voice
 * it speaks with is configured inside that plugin's own settings (e.g. the
 * TTS plugin's per-provider voice fields). With several providers registered
 * the first one wins; a picker can return if that ever becomes a real
 * situation.
 */
import type { RegisteredVoiceProvider } from "../../plugins/lib/plugin-types";

export type ResolvedPluginVoice = {
  provider: RegisteredVoiceProvider;
  voiceId: string;
};

export function activePluginVoice(
  providers: RegisteredVoiceProvider[],
): ResolvedPluginVoice | null {
  const provider = providers.find((entry) => entry.voices.length > 0);
  return provider
    ? { provider, voiceId: provider.voices[0].id }
    : null;
}
