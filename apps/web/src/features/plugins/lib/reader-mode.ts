import type {
  PluginReaderMode,
  PluginReaderTextSegment,
} from "./plugin-types";

const MODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const GRANULARITIES = new Set(["sentence", "paragraph"]);

/** Runtime gate for reader-mode registrations coming from untyped plugin JS. */
export function normalizeReaderMode(value: unknown): PluginReaderMode {
  if (!value || typeof value !== "object") {
    throw new Error("reader mode must be an object");
  }
  const mode = value as Partial<PluginReaderMode>;
  if (typeof mode.id !== "string" || !MODE_ID_PATTERN.test(mode.id)) {
    throw new Error("reader mode id must be lowercase letters, digits, and hyphens");
  }
  if (mode.kind !== "text-unit-navigator") {
    throw new Error(`unsupported reader mode kind: ${String(mode.kind)}`);
  }
  if (!Array.isArray(mode.granularities) || mode.granularities.length === 0) {
    throw new Error("reader mode must declare at least one granularity");
  }
  const granularities = [...new Set(mode.granularities)];
  if (granularities.some((item) => !GRANULARITIES.has(item))) {
    throw new Error("reader mode has an unsupported granularity");
  }
  if (typeof mode.segmentText !== "function") {
    throw new Error("reader mode must provide segmentText()");
  }
  return {
    id: mode.id,
    kind: mode.kind,
    granularities,
    segmentText: mode.segmentText,
  };
}

/**
 * Validate the segmenter's output before offsets touch a DOM Range. Rejecting
 * the whole block is safer than partially applying malformed boundaries.
 */
export function normalizeReaderTextSegments(
  value: unknown,
  textLength: number,
): PluginReaderTextSegment[] {
  if (!Array.isArray(value)) throw new Error("reader mode segments must be an array");
  const segments: PluginReaderTextSegment[] = [];
  let previousEnd = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") {
      throw new Error("reader mode segment must be an object");
    }
    const { start, end } = item as Partial<PluginReaderTextSegment>;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start! < previousEnd ||
      end! <= start! ||
      end! > textLength
    ) {
      throw new Error("reader mode returned invalid or overlapping segment offsets");
    }
    segments.push({ start: start!, end: end! });
    previousEnd = end!;
  }
  return segments;
}
