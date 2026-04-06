import { atom } from "jotai";
import {
  getReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
} from "../features/settings/lib/reader-settings";

export const topNavs = ["shelf", "context"] as const;

export type TopNav = (typeof topNavs)[number];

export const activeTopNavAtom = atom<TopNav>("shelf");

export const settingsOpenAtom = atom(false);

const readerSettingsBaseAtom = atom<ReaderSettings>(getReaderSettings());

export const readerSettingsAtom = atom(
  (get) => get(readerSettingsBaseAtom),
  (_get, set, next: ReaderSettings) => {
    set(readerSettingsBaseAtom, next);
    saveReaderSettings(next);
  },
);
