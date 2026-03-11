import { atom } from "jotai";

export const topNavs = ["shelf", "reader", "context"] as const;

export type TopNav = (typeof topNavs)[number];

export const activeTopNavAtom = atom<TopNav>("shelf");

export const settingsOpenAtom = atom(false);
