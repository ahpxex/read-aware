import type { TFunction } from "i18next";
import type {
  ReaderFontSize,
  ReaderLineSpacing,
  ReaderParagraphSpacing,
  ReaderThemePreference,
  ReadingMode,
} from "./reader-settings";

/**
 * Shared option lists for the reader appearance controls. Consumed by both the
 * global Reading settings panel and the in-reader appearance popover so the two
 * surfaces stay in lockstep. (The font picker is its own component — see
 * `FontField` — because its options are dynamic.)
 *
 * Each builder takes a `t` bound to the `reader` namespace and returns the
 * options with localized labels, so the two surfaces share one set of strings.
 */

export function fontSizeOptions(
  t: TFunction<"reader">,
): { value: ReaderFontSize; label: string }[] {
  return (
    ["xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large"] as const
  ).map((value) => ({ value, label: t(`fontSizeOption.${value}`) }));
}

export function lineSpacingOptions(
  t: TFunction<"reader">,
): { value: ReaderLineSpacing; label: string }[] {
  return (["compact", "comfortable", "relaxed"] as const).map((value) => ({
    value,
    label: t(`lineSpacingOption.${value}`),
  }));
}

export function paragraphSpacingOptions(
  t: TFunction<"reader">,
): { value: ReaderParagraphSpacing; label: string }[] {
  return (["tight", "normal", "loose"] as const).map((value) => ({
    value,
    label: t(`paragraphSpacingOption.${value}`),
  }));
}

export function readingModeOptions(
  t: TFunction<"reader">,
): { value: ReadingMode; label: string }[] {
  return (["scroll", "paginated-single", "paginated-double"] as const).map((value) => ({
    value,
    label: t(`readingModeOption.${value}`),
  }));
}

export function pageColorOptions(
  t: TFunction<"reader">,
): { value: ReaderThemePreference; label: string }[] {
  return (["auto", "light", "warm", "dark"] as const).map((value) => ({
    value,
    label: t(`pageColorOption.${value}`),
  }));
}
