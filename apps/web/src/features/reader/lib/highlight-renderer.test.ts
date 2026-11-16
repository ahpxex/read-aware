import { describe, expect, test } from "bun:test";
import type { FoliateAnnotation, FoliateView } from "./foliate-engine";
import type { Highlight, Note } from "../../annotations/lib/annotation-types";
import {
  applyNavigatorHighlight,
  navigatorLineBox,
  noteOverlayKey,
  reconcileAnnotationMarks,
  removeNavigatorHighlight,
} from "./highlight-renderer";

function recordingView() {
  const added: FoliateAnnotation[] = [];
  const removed: FoliateAnnotation[] = [];
  const view = {
    addAnnotation: async (annotation: FoliateAnnotation) => {
      added.push(annotation);
      return undefined;
    },
    deleteAnnotation: async (annotation: FoliateAnnotation) => {
      removed.push(annotation);
    },
  } as unknown as FoliateView;
  return { view, added, removed };
}

describe("navigator overlay identity", () => {
  test("uses a render key distinct from the shared CFI anchor", () => {
    const { view, added } = recordingView();
    const cfiRange = "epubcfi(/6/4!/4/2:0,/4/2:12)";

    applyNavigatorHighlight(view, cfiRange, "#faf9f6");

    expect(added).toEqual([
      {
        value: cfiRange,
        overlayKey: `read-aware:navigator:${cfiRange}`,
        style: "navigator",
        color: "#faf9f6",
      },
    ]);
  });

  test("removes that independent layer without deleting the saved annotation", () => {
    const { view, removed } = recordingView();
    const cfiRange = "epubcfi(/6/4!/4/2:0,/4/2:12)";

    removeNavigatorHighlight(view, cfiRange);

    expect(removed).toEqual([
      {
        value: cfiRange,
        overlayKey: `read-aware:navigator:${cfiRange}`,
      },
    ]);
  });
});

describe("navigator indicator geometry", () => {
  test("adds vertical breathing room without crossing into adjacent text", () => {
    expect(navigatorLineBox({ left: 389.5, top: 1786, width: 646, height: 25 }, 2)).toEqual({
      x: 389.5,
      y: 1784,
      width: 646,
      height: 29,
    });
  });

  test("keeps the inline axis exact in vertical text too", () => {
    expect(navigatorLineBox({ left: 389.5, top: 1786, width: 25, height: 646 }, 2, "vertical-rl")).toEqual({
      x: 387.5,
      y: 1786,
      width: 29,
      height: 646,
    });
  });
});

describe("note marks beside highlights", () => {
  const at = "2026-11-16T12:00:00.000Z";
  const note = (id: string, cfiRange: string): Note => ({
    id,
    bookId: "b",
    type: "note",
    text: "t",
    content: "c",
    cfiRange,
    chapterHref: null,
    createdAt: at,
    updatedAt: at,
  });
  const highlight = (id: string, cfiRange: string): Highlight => ({
    id,
    bookId: "b",
    type: "highlight",
    color: "yellow",
    style: "underline",
    text: "t",
    cfiRange,
    chapterHref: null,
    createdAt: at,
    updatedAt: at,
  });
  const reconcile = async (previous: Array<Highlight | Note>, next: Array<Highlight | Note>) => {
    const { view, added, removed } = recordingView();
    await reconcileAnnotationMarks(view, previous, next, new AbortController().signal, (error) => {
      throw error;
    });
    return {
      added: added.map((mark) => `${mark.style}:${mark.overlayKey ?? mark.value}`),
      removed: removed.map((mark) => mark.overlayKey ?? mark.value),
    };
  };

  test("a noted passage shows its dashed line on a layer of its own", async () => {
    expect((await reconcile([], [note("n", "A")])).added).toEqual([`note:${noteOverlayKey("A")}`]);
  });

  test("on an underlined passage the note's line is drawn too, not dropped", async () => {
    const { added } = await reconcile([], [highlight("h", "A"), note("n", "A")]);
    expect(added).toEqual(["underline:A", `note:${noteOverlayKey("A")}`]);
  });

  test("removing the note takes only its line; removing the mark leaves the note's line", async () => {
    expect(await reconcile([highlight("h", "A"), note("n", "A")], [highlight("h", "A")])).toEqual({
      added: [],
      removed: [noteOverlayKey("A")],
    });
    expect(await reconcile([highlight("h", "A"), note("n", "A")], [note("n", "A")])).toEqual({
      added: [],
      removed: ["A"],
    });
  });

  test("two notes on one passage share one line, which stays until the last is gone", async () => {
    const both = [note("n1", "A"), note("n2", "A")];
    expect((await reconcile([], both)).added).toEqual([`note:${noteOverlayKey("A")}`]);
    expect((await reconcile(both, [note("n2", "A")])).removed).toEqual([]);
    expect(await reconcile([note("n2", "A")], [])).toEqual({ added: [], removed: [noteOverlayKey("A")] });
  });
});
