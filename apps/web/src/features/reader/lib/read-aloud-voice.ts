/**
 * The read-aloud voice preference: the system voice, or one voice of one
 * plugin provider, addressed as `plugin:<pluginId>:<providerId>:<voiceId>`.
 * Device-local (a voice installed on this machine means nothing elsewhere),
 * so it lives in localKV like other presentation preferences.
 */
import { atom } from "jotai";
import type { RegisteredVoiceProvider } from "../../plugins/lib/plugin-types";
import { localKV } from "../../../platform/local-store";

export const SYSTEM_VOICE = "system";

const STORAGE_KEY = "read-aware-read-aloud-voice";

const baseAtom = atom<string>(localKV.getItem(STORAGE_KEY) ?? SYSTEM_VOICE);

export const readAloudVoiceAtom = atom(
  (get) => get(baseAtom),
  (_get, set, next: string) => {
    set(baseAtom, next);
    localKV.setItem(STORAGE_KEY, next);
  },
);

export function pluginVoiceRef(
  provider: RegisteredVoiceProvider,
  voiceId: string,
): string {
  return `plugin:${provider.pluginId}:${provider.id}:${voiceId}`;
}

export type ResolvedPluginVoice = {
  provider: RegisteredVoiceProvider;
  voiceId: string;
};

/**
 * Resolve a stored preference against the live providers. `null` means the
 * system voice — either chosen, or the referenced plugin voice is gone
 * (plugin disabled, vendor switched), in which case reading falls back
 * rather than falling silent.
 */
export function resolvePluginVoice(
  preference: string,
  providers: RegisteredVoiceProvider[],
): ResolvedPluginVoice | null {
  const match = preference.match(/^plugin:([^:]+):([^:]+):(.+)$/);
  if (!match) return null;
  const provider = providers.find(
    (entry) => entry.pluginId === match[1] && entry.id === match[2],
  );
  if (!provider) return null;
  return provider.voices.some((voice) => voice.id === match[3])
    ? { provider, voiceId: match[3] }
    : null;
}
