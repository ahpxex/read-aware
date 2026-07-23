// src/segment.ts
function segmenterConstructor() {
  if (typeof Intl === "undefined")
    return null;
  return Intl.Segmenter ?? null;
}
var segmenters = new Map;
function sentenceSegmenter(language) {
  const Segmenter = segmenterConstructor();
  if (!Segmenter)
    return null;
  const key = language || "";
  const cached = segmenters.get(key);
  if (cached)
    return cached;
  let segmenter;
  try {
    segmenter = new Segmenter(language || undefined, { granularity: "sentence" });
  } catch {
    segmenter = segmenters.get("") ?? new Segmenter(undefined, { granularity: "sentence" });
    segmenters.set("", segmenter);
  }
  segmenters.set(key, segmenter);
  return segmenter;
}
function trimmedSpan(text) {
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  const end = text.length - trailing;
  return end > leading ? [{ start: leading, end }] : [];
}
function segmentTextUnits({
  text,
  language,
  granularity
}) {
  if (granularity === "paragraph")
    return trimmedSpan(text);
  const segmenter = sentenceSegmenter(language);
  if (!segmenter)
    return trimmedSpan(text);
  const segmentable = text.replace(/[\r\n\u0085\u2028\u2029]/g, " ");
  const result = [];
  for (const { index, segment } of segmenter.segment(segmentable)) {
    const leading = segment.length - segment.trimStart().length;
    const trailing = segment.length - segment.trimEnd().length;
    const start = index + leading;
    const end = index + segment.length - trailing;
    if (end > start)
      result.push({ start, end });
  }
  return result;
}

// src/index.ts
var plugin = {
  activate(ctx) {
    const modes = ctx.reader.modes;
    if (!modes)
      throw new Error("Sentence Reader requires the reader:modes capability");
    modes.register({
      id: "guided-reading",
      kind: "text-unit-navigator",
      granularities: ["sentence", "paragraph"],
      segmentText: segmentTextUnits
    });
  }
};
var src_default = plugin;
export {
  src_default as default
};
