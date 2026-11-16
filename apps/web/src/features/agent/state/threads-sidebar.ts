import { atom } from "jotai";
import { isTauri } from "../../../platform/environment";
import { localKV, onLocalKVChange } from "../../../platform/local-store";

const SIDEBAR_KEY = "read-aware-agent-threads-sidebar";

/** Docked beside the conversation unless the user put it away. Device-local. */
function readDocked(): boolean {
  // Non-DOM catalog/test consumers have no preview persistence backing.
  if (!isTauri() && typeof localStorage === "undefined") return true;
  return localKV.getItem(SIDEBAR_KEY) !== "hidden";
}

const dockedBaseAtom = atom(readDocked());
// The store hydrates after startup, and a failed write rolls back: re-read on
// either, and once on mount for a value that settled before anyone listened.
dockedBaseAtom.onMount = (set) => {
  set(readDocked());
  return onLocalKVChange((key) => {
    if (key === SIDEBAR_KEY) set(readDocked());
  });
};

/** The Agent page's thread list, docked at its left edge on a wide screen. */
export const threadsSidebarDockedAtom = atom(
  (get) => get(dockedBaseAtom),
  (_get, set, docked: boolean) => {
    set(dockedBaseAtom, docked);
    localKV.setItem(SIDEBAR_KEY, docked ? "shown" : "hidden");
  },
);

/** On a phone the list is a drawer over the conversation, closed until asked for. */
export const threadsDrawerOpenAtom = atom(false);
