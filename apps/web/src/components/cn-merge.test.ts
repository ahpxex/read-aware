import { expect, test } from "bun:test";
import { cn } from "@read-aware/ui/cn";

// Body's and Display's own merge order: base (with the line-height token), size, caller.
const body = (className: string) => cn("font-sans leading-body text-fg", "text-base", className);
const display = (className: string) => cn("font-serif leading-display tracking-tight text-fg", "text-7xl", className);

test("a caller's line height replaces the design-system token", () => {
  expect(body("text-sm leading-6")).toBe("font-sans text-fg text-sm leading-6");
  expect(body("leading-relaxed")).toBe("font-sans text-fg text-base leading-relaxed");
  expect(display("leading-[1.12]")).toBe("font-serif tracking-tight text-fg text-7xl leading-[1.12]");
  expect(cn("leading-tight", "leading-display")).toBe("leading-display");
  expect(cn("leading-body", "leading-display")).toBe("leading-display");
});

test("a font size alone keeps the token, as Tailwind v4's CSS does", () => {
  expect(body("")).toBe("font-sans leading-body text-fg text-base");
  expect(body("text-sm text-fg-muted")).toBe("font-sans leading-body text-sm text-fg-muted");
  expect(display("text-[2rem]")).toBe("font-serif leading-display tracking-tight text-fg text-[2rem]");
});

test("custom font sizes still merge as sizes, not colors", () => {
  expect(cn("text-caption text-fg-muted")).toBe("text-caption text-fg-muted");
  expect(cn("text-sm", "text-eyebrow")).toBe("text-eyebrow");
});
