import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's stock scales, so our custom font-size
 * utilities (`text-eyebrow`, `text-caption`) would be classified as text
 * *colors* and silently dropped whenever a `text-fg-*` class appears in the
 * same call. Teach it the design-system sizes so they merge as font sizes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-eyebrow", "text-caption"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
