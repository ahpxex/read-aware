import { atom } from "jotai";

export const topNavs = ["shelf", "context", "settings"] as const;

export type TopNav = (typeof topNavs)[number];

export const activeTopNavAtom = atom<TopNav>("shelf");
