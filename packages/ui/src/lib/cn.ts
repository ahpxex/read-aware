import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's stock scales, so the design-system
 * utilities from `apps/web/src/index.css` need registering:
 *
 * - `text-eyebrow` / `text-caption` would be classified as text *colors* and
 *   silently dropped whenever a `text-fg-*` class appears in the same call.
 * - `leading-body` / `leading-display` would not be recognised as line
 *   heights at all, so a caller's `leading-*` could never replace them and
 *   both reached the DOM, the stylesheet's order picking the winner.
 *
 * The line-height tokens get their own group rather than joining `leading`:
 * tailwind-merge lets a later font size (`text-sm`) drop a stock `leading-*`,
 * which would strip the token from every Body/Display given a size. In
 * Tailwind v4's CSS a bare size never overrides an explicit line height, so
 * only another line height may replace a token (and a token another one).
 */
const twMerge = extendTailwindMerge<"leading-token">({
  extend: {
    classGroups: {
      "font-size": ["text-eyebrow", "text-caption"],
      "leading-token": ["leading-body", "leading-display"],
    },
    conflictingClassGroups: {
      leading: ["leading-token"],
      "leading-token": ["leading"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
