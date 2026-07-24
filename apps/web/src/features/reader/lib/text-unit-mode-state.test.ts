import { describe, expect, test } from "bun:test";
import {
  isTextUnitModeStateCompatible,
  normalizeTextUnitModeBehaviorPrefs,
  normalizeTextUnitModeState,
  preferredTextUnitModeUnitId,
} from "./text-unit-mode-state";

describe("text-unit mode state migrations", () => {
  test("reads the historical granularity field without changing the unit", () => {
    expect(normalizeTextUnitModeBehaviorPrefs({
      granularity: "paragraph",
      tapToAdvance: false,
      scrollToStep: true,
    })).toEqual({
      modeKey: null,
      unitId: "paragraph",
      tapToAdvance: false,
      scrollToStep: true,
    });
  });

  test("treats state older than granularity as sentence-based", () => {
    expect(normalizeTextUnitModeState({
      active: true,
      resting: { sectionIndex: 4, ordinal: 8, cfiRange: "epubcfi(/6/4)" },
    })).toEqual({
      active: true,
      resting: { sectionIndex: 4, ordinal: 8, cfiRange: "epubcfi(/6/4)" },
      modeKey: null,
      unitId: "sentence",
    });
  });

  test("keeps contribution identity with arbitrary valid plugin unit ids", () => {
    const prefs = normalizeTextUnitModeBehaviorPrefs({
      modeKey: "paced-reader:guided-reading",
      unitId: "stanza",
    });
    const state = normalizeTextUnitModeState({
      active: true,
      modeKey: "paced-reader:guided-reading",
      unitId: "stanza",
    });

    expect(preferredTextUnitModeUnitId(prefs, "paced-reader:guided-reading")).toBe(
      "stanza",
    );
    expect(preferredTextUnitModeUnitId(prefs, "other-reader:guided-reading")).toBeNull();
    expect(
      isTextUnitModeStateCompatible(state, "paced-reader:guided-reading", "stanza"),
    ).toBe(true);
    expect(
      isTextUnitModeStateCompatible(state, "other-reader:guided-reading", "stanza"),
    ).toBe(false);
  });
});
