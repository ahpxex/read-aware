import { atom } from "jotai";
import {
  getReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
} from "../features/settings/lib/reader-settings";
import {
  getShelfView,
  saveShelfView,
  type ShelfView,
} from "../features/shelf/lib/shelf-view";

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

const shelfViewBaseAtom = atom<ShelfView>(getShelfView());

export const shelfViewAtom = atom(
  (get) => get(shelfViewBaseAtom),
  (_get, set, next: ShelfView) => {
    set(shelfViewBaseAtom, next);
    saveShelfView(next);
  },
);
