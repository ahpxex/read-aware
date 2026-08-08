import { describe, expect, test } from "bun:test";
import { relocateDismissesShell, type ReadingLocation } from "./shell-dismissal";

const at = (current: number, cfi: string | null = `cfi-${current}`): ReadingLocation => ({
  current,
  cfi,
});

describe("relocateDismissesShell", () => {
  test("a page turn dismisses the chrome, however it was driven", () => {
    for (const reason of ["page", "snap", "scroll"] as const) {
      expect(
        relocateDismissesShell({ reason, previous: at(4), next: at(5) }),
      ).toBe(true);
    }
  });

  test("a page turn that only moves within the page still counts", () => {
    expect(
      relocateDismissesShell({
        reason: "page",
        previous: at(4, "cfi-a"),
        next: at(4, "cfi-b"),
      }),
    ).toBe(true);
  });

  test("a re-layout holding the same position does not dismiss", () => {
    // The soft keyboard shrinking the viewport: same page, a shorter visible
    // range, so the CFI moves — the bug that shut the header after every tap.
    expect(
      relocateDismissesShell({
        reason: "anchor",
        previous: at(16, "cfi-tall"),
        next: at(16, "cfi-short"),
      }),
    ).toBe(false);
  });

  test("a re-layout does not dismiss even when it repaginates", () => {
    // Rotation changes how much text a page holds, so the page index moves too.
    expect(
      relocateDismissesShell({
        reason: "anchor",
        previous: at(18, "cfi-portrait"),
        next: at(17, "cfi-landscape"),
      }),
    ).toBe(false);
  });

  test("programmatic jumps do not dismiss", () => {
    for (const reason of ["navigation", "selection"] as const) {
      expect(
        relocateDismissesShell({ reason, previous: at(4), next: at(40) }),
      ).toBe(false);
    }
    // A fixed-layout `goTo` reports no reason at all.
    expect(
      relocateDismissesShell({ reason: undefined, previous: at(4), next: at(40) }),
    ).toBe(false);
  });

  test("a snap that moved nothing does not dismiss", () => {
    // The engine reports one right after a tap that only toggled the chrome.
    expect(
      relocateDismissesShell({ reason: "snap", previous: at(16), next: at(16) }),
    ).toBe(false);
  });

  test("the first relocation of a book has nothing to compare against", () => {
    expect(
      relocateDismissesShell({ reason: "page", previous: null, next: at(1) }),
    ).toBe(false);
  });

  test("an unknown CFI on either side falls back to the page index", () => {
    expect(
      relocateDismissesShell({ reason: "page", previous: at(4, null), next: at(4, "cfi") }),
    ).toBe(false);
    expect(
      relocateDismissesShell({ reason: "page", previous: at(4, null), next: at(5, "cfi") }),
    ).toBe(true);
  });
});
