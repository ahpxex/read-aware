import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { useTextUnitNavigator, type TextUnitNavigator } from "./useTextUnitNavigator";
import type { FoliateRelocateDetail, FoliateView } from "../lib/foliate-engine";
import { readTextUnitModeState, writeTextUnitModeState } from "../lib/text-unit-mode-state";
import type { ReadingModeResume } from "@read-aware/core";
import { actorCause, actorOrigin, eventCause, reactionActor, stampEventCause } from "../../../platform/domain-actor";
import { onLocalKVCommit, type KVCommit } from "../../../platform/local-store";

function installDom() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Range: dom.window.Range,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return {
    dom,
    restore() {
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("navigator handles both event orders, same-index replacements, provider failure and retirement", async () => {
  const { dom, restore } = installDom();
  const root = createRoot(dom.window.document.getElementById("root")!);
  const actor = reactionActor("plugin:mode-test", "select-mode", eventCause(stampEventCause({}))!);
  const navigationActor = reactionActor("plugin:mode-test", "navigate-mode", eventCause(stampEventCause({}))!);
  const commits: KVCommit[] = [];
  const stopCommits = onLocalKVCommit((commit) => {
    if (commit.entries.some((entry) => entry.key === "read-aware-navigator-state:unit-build-test"))
      commits.push(commit);
  });
  const painted: string[] = [];
  const navigated: string[] = [];
  let crosses = 0;
  const pending: {
    text: string;
    resolve(value: { start: number; end: number }[]): void;
    reject(error: unknown): void;
  }[] = [];
  const segmenter: Parameters<typeof useTextUnitNavigator>[0]["segmentText"] = ({ text }) =>
    new Promise((resolve, reject) => pending.push({ text, resolve, reject }));
  const view = {
    getCFI: (_index: number, range: Range) => range.toString(),
    resolveCFI: (cfi: string) => ({
      index: 0,
      anchor: (doc: Document) => {
        const node = [...doc.querySelectorAll("p")].find((p) => p.textContent === cfi)?.firstChild;
        if (!node) throw new Error("Missing test CFI");
        const range = doc.createRange();
        range.selectNodeContents(node);
        return range;
      },
    }),
    addAnnotation: async (annotation: { value: string }) => {
      painted.push(annotation.value);
    },
    deleteAnnotation: async () => {},
    goTo: async (target: unknown) => {
      if (typeof target === "number") crosses++;
      else navigated.push(String(target));
      return { index: 0 };
    },
    book: { sections: [{ id: "first" }] },
  } as unknown as FoliateView;
  const options: Parameters<typeof useTextUnitNavigator>[0] = {
    active: true,
    bookId: "unit-build-test",
    modeKey: "test-mode:reader",
    unitId: "sentence",
    segmentText: segmenter,
    configurationOrigin: actor,
    viewRef: { current: view },
    readerRootRef: { current: null },
    veilColor: "white",
  };
  let state!: TextUnitNavigator;
  const unavailableSegmenter = () => [];
  function Harness({
    active = true,
    unitId = "sentence",
    suspended = false,
  }: {
    active?: boolean;
    unitId?: string;
    suspended?: boolean;
  }) {
    state = useTextUnitNavigator({
      ...options,
      active,
      unitId,
      suspended,
      modeKey: suspended ? null : options.modeKey,
      segmentText: suspended ? unavailableSegmenter : segmenter,
    });
    return <div data-status={state.status}>{state.current?.text}</div>;
  }
  const render = (active = true, unitId = "sentence", suspended = false) =>
    root.render(
      <ToastProvider>
        <Harness active={active} unitId={unitId} suspended={suspended} />
      </ToastProvider>,
    );
  const doc = (text: string) => new dom.window.DOMParser().parseFromString(`<p>${text}</p>`, "text/html");
  const relocate = (document: Document) => {
    const range = document.createRange();
    range.selectNodeContents(document.body);
    state.handleRelocate({ range } as FoliateRelocateDetail);
  };
  const finish = (index: number) => {
    const item = pending[index]!;
    item.resolve([{ start: 0, end: item.text.length }]);
  };
  try {
    await act(async () => {
      render();
    });
    await act(async () => {
      state.handleContentVersion("unit-build-test", "v1");
    });
    const first = doc("First.");
    await act(async () => {
      void state.handleSectionLoad(first, 0, navigationActor);
      relocate(first);
    });
    expect(state.status).toBe("building");
    await act(async () => {
      finish(0);
    });
    expect(state.current?.text).toBe("First.");
    expect(state.origin).toBe(navigationActor);
    expect(eventCause(commits.at(-1)!)).toBe(actorCause(navigationActor));

    const second = doc("Second.");
    await act(async () => {
      void state.handleSectionLoad(second, 0, navigationActor);
    });
    await act(async () => {
      finish(1);
    });
    expect(state.current).toBeNull();
    await act(async () => {
      relocate(second);
    });
    expect(state.current?.text).toBe("Second.");
    expect(state.origin).toBe(navigationActor);

    const obsolete = doc("Obsolete.");
    const replacement = doc("Replacement.");
    await act(async () => {
      void state.handleSectionLoad(obsolete, 0);
    });
    await act(async () => {
      void state.handleSectionLoad(replacement, 0);
      relocate(replacement);
    });
    await act(async () => {
      finish(2);
    });
    expect(state.current).toBeNull();
    await act(async () => {
      finish(3);
    });
    expect(state.current?.text).toBe("Replacement.");
    expect(painted).not.toContain("Obsolete.");

    await act(async () => {
      render(true, "paragraph");
    });
    expect(state.status).toBe("building");
    await act(async () => {
      pending[4]!.reject(new Error("provider unavailable"));
    });
    expect(state.status).toBe("error");
    expect(state.errorCode).toBe("reader/segmentation-failed");
    expect(state.origin).toBe(actor);
    expect(state.current).toBeNull();
    await act(async () => {
      state.next();
    });
    expect(crosses).toBe(0);

    await act(async () => {
      render(false, "paragraph");
    });
    await act(async () => {
      render(true, "paragraph");
    });
    await act(async () => {
      render(false, "paragraph");
    });
    await act(async () => {
      finish(5);
    });
    expect(state.status).toBe("inactive");
    expect(state.current).toBeNull();
    expect(painted.filter((value) => value === "Replacement.")).toHaveLength(1);

    const readerRoot = dom.window.document.createElement("div");
    const frame = dom.window.document.createElement("iframe");
    dom.window.document.body.append(readerRoot);
    readerRoot.append(frame);
    readerRoot.getBoundingClientRect = () => new dom.window.DOMRect(0, 0, 400, 800);
    frame.getBoundingClientRect = () => new dom.window.DOMRect(0, 0, 400, 800);
    const two = frame.contentDocument!;
    two.body.innerHTML = "<p>First unit.</p><p>Second unit.</p>";
    const unitTops = new Map([
      ["First unit.", 100],
      ["Second unit.", 300],
    ]);
    Object.defineProperty(two.defaultView!.Range.prototype, "getClientRects", {
      value: function (this: Range) {
        const top = unitTops.get(this.toString()) ?? 100;
        return Number.isNaN(top) ? [] : [new dom.window.DOMRect(20, top, 100, 20)];
      },
    });
    options.readerRootRef.current = readerRoot;
    Object.assign(view, { renderer: { scrolled: true } });
    await act(async () => {
      void state.handleSectionLoad(two, 0);
      relocate(two);
      render(true, "paragraph");
    });
    await act(async () => {
      finish(6);
      finish(7);
    });
    await act(async () => {
      state.next();
    });
    expect(state.current?.text).toBe("Second unit.");
    expect(navigated).toEqual([]); // Visible units move the wash, not the viewport.
    expect(actorOrigin(state.origin)).toBe("user");
    expect(actorCause(state.origin)?.root).not.toBe(actorCause(actor)?.root);
    await act(async () => {
      await state.stepNative(-1, new AbortController().signal, actor);
    });
    expect(state.current?.text).toBe("First unit.");
    expect(state.origin).toBe(actor);
    expect(eventCause(commits.at(-1)!)).toBe(actorCause(actor));
    expect(navigated).toEqual([]);
    unitTops.set("Second unit.", 700); // Below the scroll-mode comfort band.
    await act(async () => {
      state.next();
    });
    expect(state.current?.text).toBe("Second unit.");
    expect(actorOrigin(state.origin)).toBe("user");
    expect(navigated).toEqual(["Second unit."]);
    // Going back to a comfortable unit must not first scroll to the old one.
    await act(async () => {
      await state.stepNative(-1, new AbortController().signal, actor);
    });
    expect(navigated).toEqual(["Second unit."]);
    unitTops.set("Second unit.", 300);
    await act(async () => {
      state.next();
    });
    expect(state.current?.text).toBe("Second unit.");
    expect(navigated).toEqual(["Second unit."]);
    await act(async () => {
      await state.stepNative(-1, new AbortController().signal, actor);
    });
    unitTops.set("Second unit.", NaN); // Hidden chapter content is not visible.
    await act(async () => {
      state.next();
    });
    expect(navigated).toEqual(["Second unit.", "Second unit."]);
    unitTops.set("Second unit.", 300);
    const clipped = two.createRange();
    clipped.selectNodeContents(two.body.lastElementChild!);
    await act(async () => {
      state.handleRelocate({ range: clipped } as FoliateRelocateDetail);
    });
    await act(async () => {
      await state.stepNative(-1, new AbortController().signal, actor);
    });
    expect(navigated.at(-1)).toBe("First unit."); // Above the renderer's clipped viewport.
    await act(async () => {
      relocate(two);
      state.next();
    });
    expect(state.current?.text).toBe("Second unit.");
    const secondText = two.body.lastElementChild!.firstChild!;
    const page = (start: number, end: number) => {
      const range = two.createRange();
      range.setStart(secondText, start);
      range.setEnd(secondText, end);
      state.handleRelocate({ range } as FoliateRelocateDetail);
    };
    let nextPages = 0,
      previousPages = 0;
    Object.assign(view, {
      renderer: { scrolled: false },
      next: async () => {
        nextPages++;
        page(6, 12);
      },
      prev: async () => {
        previousPages++;
        page(0, 6);
      },
    });
    await act(async () => {
      page(0, 6);
      state.next();
    });
    expect(nextPages).toBe(1);
    expect(state.current?.text).toBe("Second unit.");
    await act(async () => {
      state.prev();
    });
    expect(previousPages).toBe(1);
    expect(state.current?.text).toBe("Second unit.");
    // A page the reader turned to (the resting unit is not on it): the visual
    // step re-anchors here instead of dragging the viewport back, remembers
    // the abandoned unit, and the return action goes back to it.
    const firstText = two.body.firstElementChild!.firstChild!;
    const firstOnly = two.createRange();
    firstOnly.setStart(firstText, 0);
    firstOnly.setEnd(firstText, 11);
    const travelled = navigated.length;
    await act(async () => {
      state.handleRelocate({ range: firstOnly } as FoliateRelocateDetail);
      state.next();
    });
    expect(state.current?.text).toBe("First unit.");
    expect(state.hasReturnPoint).toBe(true);
    expect(nextPages).toBe(1);
    expect(navigated.length).toBe(travelled); // No trip back to the abandoned page.
    await act(async () => {
      state.returnToCurrent();
    });
    expect(state.current?.text).toBe("Second unit.");
    expect(state.hasReturnPoint).toBe(false);
    // Backward from a turned-to page starts at its last unit.
    await act(async () => {
      state.handleRelocate({ range: firstOnly } as FoliateRelocateDetail);
      state.prev();
    });
    expect(state.current?.text).toBe("First unit.");
    expect(previousPages).toBe(1);
    await act(async () => {
      state.returnToCurrent();
    });
    expect(state.current?.text).toBe("Second unit.");
    // Semantic stepping (playback) never re-anchors from the viewport.
    await act(async () => {
      state.handleRelocate({ range: firstOnly } as FoliateRelocateDetail);
      await state.stepNative(1, new AbortController().signal, actor);
    });
    expect(state.hasReturnPoint).toBe(false);
    await act(async () => {
      await state.stepNative(-1, new AbortController().signal, actor);
    });
    expect(state.current?.text).toBe("First unit.");
    await act(async () => {
      page(0, 12);
      state.next();
    });
    expect(state.current?.text).toBe("Second unit.");
    await act(async () => {
      page(0, 12);
    });
    // Semantic unit stepping used by playback must still advance whole units.
    await act(async () => {
      await state.stepNative(-1, new AbortController().signal, actor);
    });
    expect(state.current?.text).toBe("First unit.");
    await act(async () => {
      await state.stepNative(1, new AbortController().signal, actor);
    });
    expect(state.current?.text).toBe("Second unit.");
    expect(nextPages).toBe(1);
    expect(previousPages).toBe(1);
    options.readerRootRef.current = null;
    await act(async () => {
      render(false, "paragraph", true);
    });
    expect(state.current).toBeNull();
    expect(state.canReturn).toBe(true);
    await act(async () => {
      render(true, "paragraph");
    });
    await act(async () => {
      finish(8);
      finish(9);
    });
    expect(state.current?.text).toBe("Second unit.");
    expect(state.progress?.ordinal).toBe(1);
    expect(state.position?.location.contentVersion).toBe("v1");

    const oldRevision = doc("Old revision.");
    await act(async () => {
      void state.handleSectionLoad(oldRevision, 0);
    });
    await act(async () => {
      state.handleContentVersion("unit-build-test", "v2");
    });
    expect(state.canReturn).toBe(false);
    expect(state.position).toBeNull();
    const newRevision = doc("New revision.");
    await act(async () => {
      void state.handleSectionLoad(newRevision, 0);
      relocate(newRevision);
    });
    await act(async () => {
      finish(10);
    });
    expect(state.current).toBeNull();
    await act(async () => {
      finish(11);
    });
    expect(state.current?.text).toBe("New revision.");
    expect(state.position?.location.contentVersion).toBe("v2");

    const position = state.position!;
    const returningDocument = doc("New revision.");
    await act(async () => {
      void state.handleSectionLoad(returningDocument, 0);
      relocate(returningDocument);
    });
    let returned = false;
    const returning = state.waitForPosition(position, new AbortController().signal).then((value) => {
      returned = true;
      return value;
    });
    await act(async () => {});
    expect(returned).toBe(false);
    await act(async () => {
      finish(12);
    });
    expect((await returning).cfiRange).toBe("New revision.");
    await expect(
      state.waitForPosition(
        { ...position, location: { ...position.location, contentVersion: "v1" } },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "reader/stale-location" });

    await act(async () => {
      void state.handleSectionLoad(doc("New revision."), 0);
    });
    const failedReturn = state.waitForPosition(position, new AbortController().signal).catch((error) => error);
    await act(async () => {
      pending[13]!.reject(new Error("provider rejected return"));
    });
    expect(await failedReturn).toMatchObject({ code: "reader/segmentation-failed" });
    await act(async () => {
      render(false, "paragraph");
    });
    await act(async () => {
      state.handleContentVersion("unit-build-test", "v2");
    });
    expect(state.position).toBeNull();
    expect(readTextUnitModeState("unit-build-test").active).toBe(false);
    void writeTextUnitModeState("pending-version-test", {
      active: true,
      modeKey: "test-mode:reader",
      unitId: "paragraph",
      contentVersion: "v2",
      resting: { sectionIndex: 0, ordinal: 0, cfiRange: "New revision." },
    });
    options.bookId = "pending-version-test";
    await act(async () => {
      render(false, "paragraph");
    });
    expect(readTextUnitModeState("pending-version-test").active).toBe(true);
    await act(async () => {
      state.handleContentVersion("pending-version-test", "v2");
    });
    expect(state.position).toBeNull();
    expect(readTextUnitModeState("pending-version-test").active).toBe(false);

    // Continuous scroll retains multiple sources. A relocation must select
    // its own document even if a different source was the last one loaded.
    options.bookId = "multi-source-mode-test";
    await act(async () => {
      render(false);
    });
    await act(async () => {
      state.handleContentVersion(options.bookId!, "v1");
    });
    const visible = doc("Visible source.");
    const continuation = doc("Offscreen continuation.");
    const relocateSource = (document: Document, index: number) => {
      const range = document.createRange();
      range.selectNodeContents(document.body);
      state.handleRelocate({ range, section: { current: index, total: 2 } } as FoliateRelocateDetail);
    };
    await act(async () => {
      void state.handleSectionLoad(continuation, 1);
      relocateSource(visible, 0);
      render(true);
    });
    const visibleBuild = pending.length - 1;
    expect(pending[visibleBuild]!.text).toBe("Visible source.");
    await act(async () => {
      finish(visibleBuild);
    });
    expect(state.current?.text).toBe("Visible source.");
    const builds = pending.length;
    await act(async () => {
      relocateSource(visible, 0);
    });
    expect(pending.length).toBe(builds);

    // A cached source can become visible without a new load event.
    await act(async () => {
      render(false);
    });
    await act(async () => {
      relocateSource(continuation, 1);
      render(true);
    });
    expect(pending.at(-1)!.text).toBe("Offscreen continuation.");
    await act(async () => {
      finish(pending.length - 1);
    });
    expect(state.current?.text).toBe("Offscreen continuation.");
  } finally {
    stopCommits();
    await act(async () => {
      root.unmount();
    });
    restore();
  }
});

test("the mode resumes on the unit the opened reading position rested on, wherever it was read", async () => {
  const { dom, restore } = installDom();
  const modeKey = "sentence-reader:guided-reading";
  const doc = new dom.window.DOMParser().parseFromString("<p>One.</p><p>Two.</p><p>Three.</p>", "text/html");
  const paragraph = (text: string) => [...doc.querySelectorAll("p")].find((p) => p.textContent === text)!;
  const view = {
    getCFI: (_index: number, range: Range) => range.toString(),
    resolveCFI: (cfi: string) => ({
      index: 0,
      anchor: (target: Document) => {
        const node = [...target.querySelectorAll("p")].find((p) => p.textContent === cfi)?.firstChild;
        if (!node) throw new Error("Missing test CFI");
        const range = target.createRange();
        range.selectNodeContents(node);
        return range;
      },
    }),
    addAnnotation: async () => {},
    deleteAnnotation: async () => {},
    book: { sections: [{ id: "only" }] },
  } as unknown as FoliateView;
  const viewRef = { current: view };
  const readerRootRef = { current: null };
  // Stable, like a registered plugin's: a new identity is a new segmentation policy.
  const byParagraph: Parameters<typeof useTextUnitNavigator>[0]["segmentText"] = async ({ text }) => [
    { start: 0, end: text.length },
  ];
  const address = (cfi: string, overrides: Partial<ReadingModeResume> = {}): ReadingModeResume => ({
    modeKey,
    unitId: "sentence",
    contentVersion: "v1",
    cfi,
    ...overrides,
  });
  type Opening = {
    /** This device's own record of where the mode rested. */
    local?: string;
    /** The opened position's `readingMode` (undefined: a pre-field position). */
    synced?: ReadingModeResume | null;
    /** The paragraphs on the page the reader opens at. */
    page: string[];
    suspended?: boolean;
  };
  const open = async (bookId: string, opening: Opening) => {
    if (opening.local)
      void writeTextUnitModeState(bookId, {
        active: true,
        modeKey,
        unitId: "sentence",
        contentVersion: "v1",
        resting: { sectionIndex: 0, ordinal: 0, cfiRange: opening.local },
      });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const root = createRoot(container);
    const reported: (ReadingModeResume | null)[] = [];
    let state!: TextUnitNavigator;
    function Harness({ suspended }: { suspended: boolean }) {
      state = useTextUnitNavigator({
        active: !suspended,
        suspended,
        bookId,
        modeKey: suspended ? null : modeKey,
        unitId: "sentence",
        segmentText: byParagraph,
        viewRef,
        readerRootRef,
        veilColor: "white",
        onResumeChange: (resume) => reported.push(resume),
      });
      return null;
    }
    const render = (suspended: boolean) =>
      root.render(
        <ToastProvider>
          <Harness suspended={suspended} />
        </ToastProvider>,
      );
    await act(async () => {
      render(!!opening.suspended);
    });
    await act(async () => {
      state.handleContentVersion(bookId, "v1", "system", opening.synced);
    });
    await act(async () => {
      void state.handleSectionLoad(doc, 0);
      const page = doc.createRange();
      page.setStartBefore(paragraph(opening.page[0]!));
      page.setEndAfter(paragraph(opening.page.at(-1)!));
      state.handleRelocate({ range: page } as FoliateRelocateDetail);
    });
    if (opening.suspended)
      await act(async () => {
        render(false);
      });
    await act(async () => {});
    const result = { current: state.current?.text, resume: state.resume(), reported };
    await act(async () => {
      root.unmount();
    });
    container.remove();
    return result;
  };
  try {
    // Another device read on: its position carries the unit it rested on —
    // even one segmented by paragraph — and that wins over this device's record.
    const remote = await open("synced-unit", {
      local: "One.",
      synced: address("Three.", { unitId: "paragraph" }),
      page: ["Three."],
    });
    expect(remote.current).toBe("Three.");
    expect(remote.resume).toEqual(address("Three."));
    expect(remote.reported.at(-1)).toEqual(address("Three."));

    // The position was observed with the mode off (or without a resting
    // unit): the stale local unit is dropped; the mode starts on the page.
    const off = await open("synced-none", { local: "Three.", synced: null, page: ["Two.", "Three."] });
    expect(off.current).toBe("Two.");

    // A unit for other content cannot address this one.
    const otherContent = await open("synced-other-content", {
      local: "One.",
      synced: address("Three.", { contentVersion: "v0" }),
      page: ["Two."],
    });
    expect(otherContent.current).toBe("Two.");

    // Positions recorded before they carried the unit: this device's own unit
    // resumes only when it is on the opened page — anywhere else, another
    // device may have read on since.
    const ownPage = await open("legacy-on-page", { local: "Three.", page: ["Two.", "Three."] });
    expect(ownPage.current).toBe("Three.");
    expect(ownPage.reported.at(-1)).toEqual(address("Three."));
    const movedOn = await open("legacy-elsewhere", { local: "One.", page: ["Three."] });
    expect(movedOn.current).toBe("Three.");
    // Unverified, the legacy unit never reached the recorded position.
    expect(movedOn.reported).not.toContainEqual(address("One."));

    // The plugin registers after the book opened: the retained address resumes.
    const late = await open("late-plugin", { synced: address("Two."), page: ["One.", "Two."], suspended: true });
    expect(late.current).toBe("Two.");
  } finally {
    restore();
  }
});
