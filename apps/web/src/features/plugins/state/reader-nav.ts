/**
 * Plugin → reader navigation channel: `ctx.reader.goTo` dispatches here; App
 * consumes it (opening the target book first when needed) and forwards to the
 * reader session's chapter/annotation navigation. Same atom-bridge pattern as
 * the chat's open-book requests.
 */
import { atom, getDefaultStore } from "jotai";

export type PluginReaderNavRequest = {
  /** Unique per dispatch so identical targets re-fire. */
  id: string;
  bookId?: string;
  cfi?: string;
  href?: string;
};

export const pluginReaderNavAtom = atom<PluginReaderNavRequest | null>(null);

export function requestPluginReaderNav(target: {
  bookId?: string;
  cfi?: string;
  href?: string;
}): void {
  getDefaultStore().set(pluginReaderNavAtom, { id: crypto.randomUUID(), ...target });
}
