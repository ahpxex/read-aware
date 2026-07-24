import type {
  PluginLocalizedText,
  PluginReaderMode,
  PluginReaderModeCopy,
  PluginReaderTextSegment,
  PluginReaderTextUnit,
} from "./plugin-types";

const CONTRIBUTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function normalizeLocalizedText(value: unknown, path: string): PluginLocalizedText {
  if (!value || typeof value !== "object") {
    throw new Error(`${path} must be localized text`);
  }
  const candidate = value as Partial<PluginLocalizedText>;
  if (typeof candidate.default !== "string" || candidate.default.trim() === "") {
    throw new Error(`${path}.default must be a non-empty string`);
  }
  let translations: Record<string, string> | undefined;
  if (candidate.translations !== undefined) {
    if (!candidate.translations || typeof candidate.translations !== "object") {
      throw new Error(`${path}.translations must be an object`);
    }
    translations = {};
    for (const [locale, text] of Object.entries(candidate.translations)) {
      if (!locale.trim() || typeof text !== "string" || text.trim() === "") {
        throw new Error(`${path}.translations must contain non-empty locale strings`);
      }
      translations[locale] = text;
    }
  }
  return { default: candidate.default, ...(translations ? { translations } : {}) };
}

function normalizeUnit(value: unknown, index: number): PluginReaderTextUnit {
  if (!value || typeof value !== "object") {
    throw new Error(`reader mode unit ${index} must be an object`);
  }
  const unit = value as Partial<PluginReaderTextUnit>;
  if (typeof unit.id !== "string" || !CONTRIBUTION_ID_PATTERN.test(unit.id)) {
    throw new Error("reader mode unit id must be lowercase letters, digits, and hyphens");
  }
  return {
    id: unit.id,
    label: normalizeLocalizedText(unit.label, `reader mode unit ${unit.id}.label`),
    previousLabel: normalizeLocalizedText(
      unit.previousLabel,
      `reader mode unit ${unit.id}.previousLabel`,
    ),
    nextLabel: normalizeLocalizedText(unit.nextLabel, `reader mode unit ${unit.id}.nextLabel`),
    ...(unit.toggleLabel
      ? {
          toggleLabel: normalizeLocalizedText(
            unit.toggleLabel,
            `reader mode unit ${unit.id}.toggleLabel`,
          ),
        }
      : {}),
    ...(typeof unit.icon === "string" && unit.icon ? { icon: unit.icon } : {}),
  };
}

function normalizeCopy(value: unknown): PluginReaderModeCopy {
  if (!value || typeof value !== "object") throw new Error("reader mode copy must be an object");
  const copy = value as Partial<PluginReaderModeCopy>;
  const settings = copy.settings as Partial<PluginReaderModeCopy["settings"]> | undefined;
  const shortcuts = copy.shortcuts as Partial<PluginReaderModeCopy["shortcuts"]> | undefined;
  if (!settings) throw new Error("reader mode copy.settings must be an object");
  if (!shortcuts) throw new Error("reader mode copy.shortcuts must be an object");
  const tap = settings.tapToAdvance as
    | Partial<PluginReaderModeCopy["settings"]["tapToAdvance"]>
    | undefined;
  const scroll = settings.scrollToStep as
    | Partial<PluginReaderModeCopy["settings"]["scrollToStep"]>
    | undefined;
  if (!tap) throw new Error("reader mode copy.settings.tapToAdvance must be an object");
  if (!scroll) throw new Error("reader mode copy.settings.scrollToStep must be an object");

  return {
    title: normalizeLocalizedText(copy.title, "reader mode copy.title"),
    enable: normalizeLocalizedText(copy.enable, "reader mode copy.enable"),
    exit: normalizeLocalizedText(copy.exit, "reader mode copy.exit"),
    returnToCurrent: normalizeLocalizedText(
      copy.returnToCurrent,
      "reader mode copy.returnToCurrent",
    ),
    showToolbars: normalizeLocalizedText(copy.showToolbars, "reader mode copy.showToolbars"),
    moreActions: normalizeLocalizedText(copy.moreActions, "reader mode copy.moreActions"),
    collapseActions: normalizeLocalizedText(
      copy.collapseActions,
      "reader mode copy.collapseActions",
    ),
    menuLabel: normalizeLocalizedText(copy.menuLabel, "reader mode copy.menuLabel"),
    settings: {
      description: normalizeLocalizedText(
        settings.description,
        "reader mode copy.settings.description",
      ),
      unitLabel: normalizeLocalizedText(
        settings.unitLabel,
        "reader mode copy.settings.unitLabel",
      ),
      tapToAdvance: {
        title: normalizeLocalizedText(
          tap.title,
          "reader mode copy.settings.tapToAdvance.title",
        ),
        description: normalizeLocalizedText(
          tap.description,
          "reader mode copy.settings.tapToAdvance.description",
        ),
      },
      scrollToStep: {
        title: normalizeLocalizedText(
          scroll.title,
          "reader mode copy.settings.scrollToStep.title",
        ),
        description: normalizeLocalizedText(
          scroll.description,
          "reader mode copy.settings.scrollToStep.description",
        ),
      },
    },
    shortcuts: {
      description: normalizeLocalizedText(
        shortcuts.description,
        "reader mode copy.shortcuts.description",
      ),
      volumeKeys: normalizeLocalizedText(
        shortcuts.volumeKeys,
        "reader mode copy.shortcuts.volumeKeys",
      ),
    },
  };
}

/** Runtime gate for reader-mode registrations coming from untyped plugin JS. */
export function normalizeReaderMode(value: unknown): PluginReaderMode {
  if (!value || typeof value !== "object") {
    throw new Error("reader mode must be an object");
  }
  const mode = value as Partial<PluginReaderMode>;
  if (typeof mode.id !== "string" || !CONTRIBUTION_ID_PATTERN.test(mode.id)) {
    throw new Error("reader mode id must be lowercase letters, digits, and hyphens");
  }
  if (mode.kind !== "text-unit-navigator") {
    throw new Error(`unsupported reader mode kind: ${String(mode.kind)}`);
  }
  if (!Array.isArray(mode.units) || mode.units.length === 0) {
    throw new Error("reader mode must declare at least one unit");
  }
  const units = mode.units.map(normalizeUnit);
  if (new Set(units.map((unit) => unit.id)).size !== units.length) {
    throw new Error("reader mode unit ids must be unique");
  }
  if (typeof mode.defaultUnitId !== "string" || !units.some((unit) => unit.id === mode.defaultUnitId)) {
    throw new Error("reader mode defaultUnitId must reference a declared unit");
  }
  if (typeof mode.segmentText !== "function") {
    throw new Error("reader mode must provide segmentText()");
  }
  return {
    id: mode.id,
    kind: mode.kind,
    ...(typeof mode.icon === "string" && mode.icon ? { icon: mode.icon } : {}),
    units,
    defaultUnitId: mode.defaultUnitId,
    copy: normalizeCopy(mode.copy),
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

/** Resolve an opaque persisted unit id against the currently installed mode. */
export function resolveReaderModeUnit(
  mode: PluginReaderMode,
  preferredUnitId?: string | null,
): PluginReaderTextUnit {
  return (
    mode.units.find((unit) => unit.id === preferredUnitId) ??
    mode.units.find((unit) => unit.id === mode.defaultUnitId) ??
    mode.units[0]!
  );
}
