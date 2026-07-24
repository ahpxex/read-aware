import { describe, expect, test } from "bun:test";
import {
  normalizeReaderMode,
  normalizeReaderTextSegments,
  resolveReaderModeUnit,
} from "./reader-mode";

const text = (value: string) => ({ default: value });

function modeFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "paced-reader",
    kind: "text-unit-navigator",
    icon: "rows",
    units: [
      {
        id: "line",
        label: text("By line"),
        previousLabel: text("Previous line"),
        nextLabel: text("Next line"),
      },
      {
        id: "stanza",
        label: text("By stanza"),
        previousLabel: text("Previous stanza"),
        nextLabel: text("Next stanza"),
        toggleLabel: text("Stanza mode"),
        icon: "paragraph",
      },
    ],
    defaultUnitId: "line",
    copy: {
      title: text("Paced reading"),
      enable: text("Start paced reading"),
      exit: text("Exit paced reading"),
      returnToCurrent: text("Back to current unit"),
      showToolbars: text("Show toolbars"),
      moreActions: text("More actions"),
      collapseActions: text("Collapse actions"),
      menuLabel: text("Paced reader"),
      settings: {
        description: text("Configure paced reading."),
        unitLabel: text("Step unit"),
        tapToAdvance: { title: text("Tap to advance"), description: text("Tap once.") },
        scrollToStep: { title: text("Swipe to step"), description: text("Swipe once.") },
      },
      shortcuts: {
        description: text("Active while paced reading is on."),
        volumeKeys: text("Step with volume keys"),
      },
    },
    segmentText: () => [{ start: 0, end: 4 }],
    ...overrides,
  };
}

describe("reader mode contract", () => {
  test("accepts plugin-defined unit ids and preserves its segmenter", () => {
    const input = modeFixture();
    const mode = normalizeReaderMode(input);

    expect(mode.units.map((unit) => unit.id)).toEqual(["line", "stanza"]);
    expect(mode.defaultUnitId).toBe("line");
    expect(mode.segmentText).toBe(input.segmentText);
    expect(resolveReaderModeUnit(mode, "stanza").id).toBe("stanza");
    expect(resolveReaderModeUnit(mode, "missing").id).toBe("line");
  });

  test("rejects unknown mode kinds and malformed registrations", () => {
    expect(() => normalizeReaderMode(null)).toThrow();
    expect(() => normalizeReaderMode(modeFixture({ kind: "raw-dom" }))).toThrow(
      "unsupported reader mode kind",
    );
    expect(() => normalizeReaderMode(modeFixture({ units: [] }))).toThrow(
      "at least one unit",
    );
  });

  test("rejects duplicate units and a default outside the declared set", () => {
    const unit = modeFixture().units[0];
    expect(() => normalizeReaderMode(modeFixture({ units: [unit, unit] }))).toThrow("unique");
    expect(() => normalizeReaderMode(modeFixture({ defaultUnitId: "page" }))).toThrow(
      "defaultUnitId",
    );
  });

  test("rejects missing or empty localized copy", () => {
    expect(() => normalizeReaderMode(modeFixture({ copy: undefined }))).toThrow("copy");
    const fixture = modeFixture();
    expect(() =>
      normalizeReaderMode({
        ...fixture,
        copy: { ...fixture.copy, title: { default: "" } },
      }),
    ).toThrow("non-empty");
  });

  test("accepts ordered spans and rejects overlaps or out-of-bounds offsets", () => {
    expect(normalizeReaderTextSegments(
      [{ start: 0, end: 4 }, { start: 5, end: 8 }],
      8,
    )).toEqual([{ start: 0, end: 4 }, { start: 5, end: 8 }]);
    expect(() => normalizeReaderTextSegments(
      [{ start: 0, end: 5 }, { start: 4, end: 8 }],
      8,
    )).toThrow("invalid or overlapping");
    expect(() => normalizeReaderTextSegments([{ start: 0, end: 9 }], 8)).toThrow();
  });
});
