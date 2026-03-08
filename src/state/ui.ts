import { atom } from "jotai";

export const focusTags = ["feature", "bug", "reader", "context", "desktop"] as const;

export type FocusTag = (typeof focusTags)[number];

export const focusTagAtom = atom<FocusTag>("feature");
