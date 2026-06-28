import type {
  ReaderContentWidth,
  ReaderFontSize,
  ReaderLineSpacing,
  ReaderMargins,
  ReaderParagraphSpacing,
  ReaderTextAlign,
  ReaderThemePreference,
  ReadingMode,
} from "./reader-settings";

/**
 * Shared option lists for the reader appearance controls. Consumed by both the
 * global Reading settings panel and the in-reader appearance popover so the two
 * surfaces stay in lockstep. (The font picker is its own component — see
 * `FontField` — because its options are dynamic.)
 */

export const FONT_SIZE_OPTIONS: { value: ReaderFontSize; label: string }[] = [
  { value: "x-small", label: "XS" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "x-large", label: "XL" },
];

export const LINE_SPACING_OPTIONS: { value: ReaderLineSpacing; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "relaxed", label: "Relaxed" },
];

export const PARAGRAPH_SPACING_OPTIONS: { value: ReaderParagraphSpacing; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "loose", label: "Loose" },
];

export const READING_MODE_OPTIONS: { value: ReadingMode; label: string }[] = [
  { value: "scroll", label: "Scroll" },
  { value: "paginated-single", label: "Single Page" },
  { value: "paginated-double", label: "Two Pages" },
];

export const CONTENT_WIDTH_OPTIONS: { value: ReaderContentWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "medium", label: "Medium" },
  { value: "wide", label: "Wide" },
];

export const MARGINS_OPTIONS: { value: ReaderMargins; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "normal", label: "Normal" },
  { value: "spacious", label: "Spacious" },
];

export const TEXT_ALIGN_OPTIONS: { value: ReaderTextAlign; label: string }[] = [
  { value: "start", label: "Left" },
  { value: "justify", label: "Justified" },
];

export const PAGE_COLOR_OPTIONS: { value: ReaderThemePreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "warm", label: "Warm" },
  { value: "dark", label: "Dark" },
];
