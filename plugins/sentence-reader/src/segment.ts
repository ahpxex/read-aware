import type {
  PluginReaderTextSegment,
  PluginReaderTextSegmentInput,
} from "@read-aware/plugin-types";

// Minimal Intl.Segmenter surface: the workspace's ES2020 lib predates its
// typings, while every shipping WKWebView/Chromium runtime supports it.
type SentenceSegments = Iterable<{ index: number; segment: string }>;
type SentenceSegmenter = { segment: (input: string) => SentenceSegments };
type SegmenterConstructor = new (
  locales?: string,
  options?: { granularity?: "grapheme" | "word" | "sentence" },
) => SentenceSegmenter;

function segmenterConstructor(): SegmenterConstructor | null {
  if (typeof Intl === "undefined") return null;
  return (Intl as { Segmenter?: SegmenterConstructor }).Segmenter ?? null;
}

const segmenters = new Map<string, SentenceSegmenter>();

function sentenceSegmenter(language?: string): SentenceSegmenter | null {
  const Segmenter = segmenterConstructor();
  if (!Segmenter) return null;
  const key = language || "";
  const cached = segmenters.get(key);
  if (cached) return cached;

  let segmenter: SentenceSegmenter;
  try {
    segmenter = new Segmenter(language || undefined, { granularity: "sentence" });
  } catch {
    segmenter = segmenters.get("") ?? new Segmenter(undefined, { granularity: "sentence" });
    segmenters.set("", segmenter);
  }
  segmenters.set(key, segmenter);
  return segmenter;
}

function trimmedSpan(text: string): PluginReaderTextSegment[] {
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  const end = text.length - trailing;
  return end > leading ? [{ start: leading, end }] : [];
}

/**
 * Plugin-owned segmentation policy. Newlines from pretty-printed book source
 * are replaced with equal-width spaces before UAX #29 segmentation so a hard
 * source wrap cannot split a visual sentence; offsets still map to the host's
 * original text exactly.
 */
export function segmentTextUnits({
  text,
  language,
  unitId,
}: PluginReaderTextSegmentInput): PluginReaderTextSegment[] {
  if (unitId === "paragraph") return trimmedSpan(text);
  if (unitId !== "sentence") return [];

  const segmenter = sentenceSegmenter(language);
  if (!segmenter) return trimmedSpan(text);

  const segmentable = text.replace(/[\r\n\u0085\u2028\u2029]/g, " ");
  const result: PluginReaderTextSegment[] = [];
  for (const { index, segment } of segmenter.segment(segmentable)) {
    const leading = segment.length - segment.trimStart().length;
    const trailing = segment.length - segment.trimEnd().length;
    const start = index + leading;
    const end = index + segment.length - trailing;
    if (end > start) result.push({ start, end });
  }
  return result;
}
