/**
 * Where a phone's reader actions sit: in the bottom toolbar (the default,
 * within thumb reach) or in a row under the top bar, every control at the top
 * like a Kindle's. Device-local: a layout preference of this screen.
 */
import { atom, getDefaultStore } from "jotai";
import { localKV, onLocalKVChange } from "../../../platform/local-store";

export type ReaderToolbarPlacement = "bottom" | "top";

export const READER_TOOLBAR_PLACEMENT_KEY = "read-aware-reader-toolbar-placement";

function readPlacement(): ReaderToolbarPlacement {
  return localKV.getItem(READER_TOOLBAR_PLACEMENT_KEY) === "top" ? "top" : "bottom";
}

const placementBaseAtom = atom<ReaderToolbarPlacement>(readPlacement());

onLocalKVChange((key) => {
  if (key === READER_TOOLBAR_PLACEMENT_KEY) getDefaultStore().set(placementBaseAtom, readPlacement());
});

export const readerToolbarPlacementAtom = atom(
  (get) => get(placementBaseAtom),
  (_get, set, next: ReaderToolbarPlacement) => {
    set(placementBaseAtom, next);
    localKV.setItem(READER_TOOLBAR_PLACEMENT_KEY, next);
  },
);
