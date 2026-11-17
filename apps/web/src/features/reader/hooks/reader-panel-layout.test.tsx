import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { getDefaultStore } from "jotai";
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { LocalWriteFailureToasts } from "../../../components/LocalWriteFailureToasts";
import { initI18n } from "../../../i18n";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerPanels } from "../../../services/reader-panels";
import { flushLocalKV, localKV, onLocalKVChange, onLocalKVCommit } from "../../../platform/local-store";
import {
  actorCause,
  causalActor,
  eventCause,
  reactionActor,
  stampEventCause,
  type DomainActor,
} from "../../../platform/domain-actor";
import { buildPluginContext } from "../../plugins/runtime/plugin-context";
import { getReaderPanelLayout, updateReaderPanelLayout } from "../lib/reader-panel-layout";
import { useReaderControls } from "./useReaderControls";
import { useReaderPanels } from "./useReaderPanels";
import { useReaderResponsiveLayout } from "./useReaderResponsiveLayout";
import { readerPanelAcknowledgementsAtom, readerPanelIntentAtom } from "../state/panel-intent";
import { askAiRequestAtom } from "../../ai/state/chat-intent";

const key = "read-aware-reader-panels";
const sizesKey = "read-aware-reader-panel-sizes";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

if (process.env.PANEL_LAYOUT_CASE === "1") {
  const begin = <T,>(operation: () => Promise<T>): Promise<T> => {
    let promise!: Promise<T>;
    act(() => {
      promise = operation();
    });
    return promise;
  };
  const command = readerPanels.setPanel.bind(readerPanels);
  const requestPanel = (...args: Parameters<typeof command>) => begin(() => command(...args));
  let dom: JSDOM, root: Root, state: ReturnType<typeof useReaderPanels>;
  let globals: Map<string, PropertyDescriptor | undefined>;
  const disk = new Map<string, string>();
  const pending: { value: string; commit(): void; reject(error: unknown): void }[] = [];
  let hold = false,
    sessionId: string;
  function open(bookId: string) {
    sessionId = readingRuntime.begin(bookId);
    const at = { bookId, contentVersion: "v1", cfi: "start" };
    readingRuntime.attach(sessionId, { navigate: async () => at, step: async () => at }, at);
  }
  function Harness({
    bookId,
    exclusive,
    layoutOrigin,
  }: {
    bookId: string;
    exclusive: boolean;
    layoutOrigin?: DomainActor;
  }) {
    const controls = useReaderControls();
    state = useReaderPanels(bookId, controls.visible, exclusive, controls.origin, layoutOrigin);
    useLayoutEffect(() => readingRuntime.bindControls(sessionId, controls.controls), [bookId, controls.controls]);
    return (
      <>
        <section aria-label="toc" inert={!(controls.visible && state.toc)} />
        <section aria-label="chat" inert={!(controls.visible && state.chat)} />
        {state.appearance && <div role="dialog">Appearance</div>}
        {state.annotations && <div role="dialog">Annotations</div>}
      </>
    );
  }
  const render = (bookId = "book", exclusive = false) =>
    root.render(
      <StrictMode>
        <ToastProvider>
          <LocalWriteFailureToasts />
          <Harness bookId={bookId} exclusive={exclusive} />
        </ToastProvider>
      </StrictMode>,
    );
  const flush = async () => {
    await act(async () => {
      await tick();
    });
  };
  beforeEach(async () => {
    await initI18n("en");
    dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    const values = {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    globals = new Map(Object.keys(values).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries(values))
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    Object.assign(dom.window, {
      __TAURI_INTERNALS__: {
        invoke(command: string, args: { key: string; value: string }) {
          if (command !== "set_kv") return Promise.resolve();
          return new Promise<void>((resolve, reject) => {
            const commit = () => {
              disk.set(args.key, args.value);
              resolve();
            };
            if (hold && [key, sizesKey].includes(args.key)) pending.push({ value: args.value, commit, reject });
            else commit();
          });
        },
      },
    });
    hold = false;
    getDefaultStore().set(readerPanelIntentAtom, null);
    getDefaultStore().set(readerPanelAcknowledgementsAtom, { panel: null, ask: null });
    getDefaultStore().set(askAiRequestAtom, null);
    await localKV.setItemAsync(
      key,
      JSON.stringify({ book: { tocOpen: false, notesOpen: false }, other: { tocOpen: true, notesOpen: true } }),
    );
    await localKV.setItemAsync(sizesKey, JSON.stringify({ toc: 288, chat: 352 }));
    open("book");
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      render();
      await tick();
    });
    hold = true;
  });
  afterEach(async () => {
    hold = false;
    await act(async () => {
      root.unmount();
      readingRuntime.closed();
      for (const write of pending.splice(0)) write.commit();
      await flushLocalKV();
      await tick();
    });
    dom.window.close();
    for (const [name, value] of globals) {
      if (value) Object.defineProperty(globalThis, name, value);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  test("real hook reveals chrome, mirrors optimistic state, then acknowledges durable DOM completion", async () => {
    let settled = false;
    const promise = requestPanel("toc", true).then((value) => {
      settled = true;
      return value;
    });
    await flush();
    expect(pending).toHaveLength(1);
    expect(state.toc).toBe(true);
    expect(settled).toBe(false);
    expect(JSON.parse(disk.get(key)!).book.tocOpen).toBe(false);
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    expect((await promise).snapshot.panels.toc).toEqual({ open: true, visible: true });
    expect(dom.window.document.querySelector('[aria-label="toc"]')!.hasAttribute("inert")).toBe(false);
  });
  test("width API commits through the mounted hook and reports narrow-window preferences honestly", async () => {
    let settled = false;
    const request = begin(() => readerPanels.setWidth("chat", 480)).then((result) => {
      settled = true;
      return result;
    });
    await flush();
    expect(pending).toHaveLength(1);
    expect(settled).toBe(false);
    expect(readerPanels.snapshot()?.sizes).toEqual({ toc: 288, chat: 480 });
    expect(JSON.parse(disk.get(sizesKey)!).chat).toBe(352);
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    expect((await request).snapshot).toMatchObject({ layout: "docked", sizes: { chat: 480 }, controlsVisible: false });
    await act(async () => {
      render("book", true);
    });
    expect(readerPanels.snapshot()).toMatchObject({ layout: "exclusive", sizes: { chat: 480 } });
    expect(state.chat).toBe(false);
    expect(state.chatFocusRequestId).toBe(0);
  });
  test("crossing the phone breakpoint switches the panel layout at once, as the system's change", async () => {
    const media = new dom.window.EventTarget();
    let narrow = false;
    Object.defineProperty(media, "matches", { get: () => narrow });
    Object.assign(dom.window, { matchMedia: () => media });
    function Responsive() {
      const layout = useReaderResponsiveLayout();
      return <Harness bookId="book" exclusive={layout.exclusive} layoutOrigin={layout.origin} />;
    }
    await act(async () => {
      root.render(
        <ToastProvider>
          <Responsive />
        </ToastProvider>,
      );
      await tick();
    });
    await act(async () => {
      narrow = true;
      media.dispatchEvent(new dom.window.Event("change"));
      await tick();
    });
    expect(readerPanels.snapshot()?.layout).toBe("exclusive");
    expect(eventCause(readerPanels.snapshot()!)?.root).toBeDefined();
    await act(async () => {
      narrow = false;
      media.dispatchEvent(new dom.window.Event("change"));
      await tick();
    });
    expect(readerPanels.snapshot()?.layout).not.toBe("exclusive");
  });
  test("failed width writes roll back the atom and subsequent patches preserve settled sibling widths", async () => {
    const first = begin(() => readerPanels.setWidth("toc", 400)).catch((error) => error);
    await flush();
    const next = begin(() => readerPanels.setWidth("chat", 500));
    await flush();
    expect(await first).toMatchObject({ code: "reader/superseded" });
    await act(async () => {
      pending.shift()!.reject({ code: "db/locked", message: "private" });
      await tick();
    });
    expect(JSON.parse(pending[0].value)).toEqual({ toc: 288, chat: 500 });
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    expect((await next).snapshot.sizes).toEqual({ toc: 288, chat: 500 });
    expect(readerPanels.snapshot()?.sizes).toEqual({ toc: 288, chat: 500 });
  });
  test("failed native write rolls back and yields one translated notice plus the exact error code", async () => {
    const request = requestPanel("toc", true).catch((error) => error);
    await flush();
    await act(async () => {
      pending.shift()!.reject({ code: "db/locked", message: "RAW private database failure" });
      await tick();
    });
    expect(await request).toMatchObject({ code: "db/locked" });
    expect(state.toc).toBe(false);
    expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(dom.window.document.querySelector('[role="status"]')!.textContent).toContain("Change not saved");
    expect(dom.window.document.body.textContent).not.toContain("RAW private");
    hold = false;
    const retry = requestPanel("toc", true);
    await flush();
    await retry;
    expect(state.toc).toBe(true);
  });
  test("new intent cancels the older caller without undoing its already dispatched durable write", async () => {
    const first = requestPanel("toc", true).catch((error) => error);
    await flush();
    const second = requestPanel("chat", true);
    await flush();
    expect(pending).toHaveLength(1);
    expect(await first).toMatchObject({ code: "reader/superseded" });
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    expect(pending).toHaveLength(1);
    expect(JSON.parse(pending[0].value).book).toEqual({ tocOpen: true, notesOpen: true });
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    await second;
    expect(state.chatFocusRequestId).toBe(1);
    expect(JSON.parse(disk.get(key)!).other).toEqual({ tocOpen: true, notesOpen: true });
  });
  test("new intent reads a failed predecessor's rollback instead of its optimistic sibling field", async () => {
    const first = requestPanel("toc", true).catch((error) => error);
    await flush();
    const second = requestPanel("chat", true);
    await flush();
    await act(async () => {
      pending.shift()!.reject({ code: "db/locked", message: "rejected" });
      await tick();
    });
    await first;
    expect(JSON.parse(pending[0].value).book).toEqual({ tocOpen: false, notesOpen: true });
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    await second;
    expect(state.toc).toBe(false);
    expect(state.chat).toBe(true);
  });
  test("exclusive sheets are transient: one at a time, closed with chrome, never written or restored", async () => {
    await act(async () => {
      render("book", true);
    });
    const before = disk.get(key);
    const toc = requestPanel("toc", true);
    await flush();
    await toc;
    expect(pending).toHaveLength(0);
    expect(state.toc).toBe(true);
    expect(readerPanels.snapshot()).toMatchObject({
      layout: "exclusive",
      panels: { toc: { open: true, visible: true } },
    });
    const chat = requestPanel("chat", true);
    await flush();
    await chat;
    expect(state.toc).toBe(false);
    expect(state.chat).toBe(true);
    expect(state.chatFocusRequestId).toBe(1);
    // The bottom bar's drawer panels share the same room: each replaces the rest.
    const appearance = requestPanel("appearance", true);
    await flush();
    await appearance;
    expect(state.chat).toBe(false);
    expect(state.appearance).toBe(true);
    const annotations = requestPanel("annotations", true);
    await flush();
    await annotations;
    expect(state.appearance).toBe(false);
    expect(state.annotations).toBe(true);
    const back = requestPanel("chat", true);
    await flush();
    await back;
    expect(state.annotations).toBe(false);
    expect(state.chat).toBe(true);
    expect(dom.window.document.querySelector('[aria-label="chat"]')!.hasAttribute("inert")).toBe(false);
    const hide = begin(() => readingRuntime.setControls(false));
    await flush();
    await hide;
    expect(state.chat).toBe(false);
    expect(readerPanels.snapshot()?.panels.chat).toEqual({ open: false, visible: false });
    const reveal = begin(() => readingRuntime.setControls(true));
    await flush();
    await reveal;
    expect(state.toc).toBe(false);
    expect(state.chat).toBe(false);
    expect(pending).toHaveLength(0);
    expect(disk.get(key)).toBe(before);
    // A book whose docked layout remembers open panels still opens clean on a phone.
    await act(async () => {
      open("other");
      render("other", true);
      await tick();
    });
    expect(getReaderPanelLayout("other")).toEqual({ tocOpen: true, notesOpen: true });
    expect(state.toc).toBe(false);
    expect(state.chat).toBe(false);
    expect(readerPanels.snapshot()).toMatchObject({
      bookId: "other",
      layout: "exclusive",
      panels: { toc: { open: false }, chat: { open: false } },
    });
  });
  test("breakpoint changes hand TOC/chat to the other store and drop the sheets being left", async () => {
    await act(async () => {
      render("book", true);
    });
    const toc = requestPanel("toc", true);
    await flush();
    await toc;
    expect(state.toc).toBe(true);
    await act(async () => {
      render("book", false);
      await tick();
    });
    expect(state.toc).toBe(false);
    expect(readerPanels.snapshot()?.layout).toBe("docked");
    await act(async () => {
      render("book", true);
      await tick();
    });
    expect(state.toc).toBe(false);
    expect(pending).toHaveLength(0);
    hold = false;
    const docked = (async () => {
      await act(async () => {
        render("book", false);
        await tick();
      });
      const p = requestPanel("chat", true);
      await flush();
      await p;
    })();
    await docked;
    expect(state.chat).toBe(true);
    expect(JSON.parse(disk.get(key)!).book).toEqual({ tocOpen: false, notesOpen: true });
    await act(async () => {
      render("book", true);
      await tick();
    });
    expect(state.chat).toBe(false);
    await act(async () => {
      render("book", false);
      await tick();
    });
    expect(state.chat).toBe(true);
  });
  test("external writes and rollback mirror to React and the public snapshot without write echo", async () => {
    let external!: Promise<unknown>;
    await act(async () => {
      external = localKV
        .setItemAsync(key, JSON.stringify({ book: { tocOpen: true, notesOpen: true } }))
        .catch((e) => e);
      await tick();
    });
    expect(state.toc).toBe(true);
    expect(readerPanels.snapshot()?.panels.chat.open).toBe(true);
    await act(async () => {
      pending.shift()!.reject({ code: "db/locked", message: "external failed" });
      await tick();
    });
    await external;
    expect(state.toc).toBe(false);
    expect(state.chat).toBe(false);
    expect(pending).toHaveLength(0);
  });
  test("book replacement cancels queued old-owner writes and never exposes old transient panels", async () => {
    const appearance = requestPanel("appearance", true);
    await flush();
    await appearance;
    expect(state.appearance).toBe(true);
    const blocker = begin(() => localKV.setItemAsync(key, disk.get(key)!));
    const old = requestPanel("chat", true).catch((error) => error);
    await flush();
    await act(async () => {
      open("other");
      render("other");
      await tick();
    });
    expect(await old).toMatchObject({ code: "reader/superseded" });
    expect(state.appearance).toBe(false);
    expect(state.toc).toBe(true);
    expect(state.chat).toBe(true);
    expect(readerPanels.snapshot()?.bookId).toBe("other");
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    await blocker;
    expect(pending).toHaveLength(0);
    expect(JSON.parse(disk.get(key)!).book.notesOpen).toBe(false);
  });
  test("transient panels do not persist and hiding chrome closes them without clearing dock preferences", async () => {
    hold = false;
    const toc = requestPanel("toc", true);
    await flush();
    await toc;
    for (const panel of ["annotations", "appearance"] as const) {
      const p = requestPanel(panel, true);
      await flush();
      await p;
    }
    const before = disk.get(key);
    const hide = begin(() => readingRuntime.setControls(false));
    await flush();
    await hide;
    expect(state.appearance).toBe(false);
    expect(state.annotations).toBe(false);
    expect(state.toc).toBe(true);
    expect(readerPanels.snapshot()?.panels.toc).toEqual({ open: true, visible: false });
    expect(disk.get(key)).toBe(before);
  });
  test("same-value requests skip persistence and helper parsing defends malformed legacy values", async () => {
    const same = requestPanel("toc", false);
    await flush();
    await same;
    expect(pending).toHaveLength(0);
    await expect(
      updateReaderPanelLayout("book", (p) => ({ ...p, tocOpen: "yes" as unknown as boolean })),
    ).rejects.toMatchObject({ code: "reader/invalid-target" });
    for (const raw of ["[]", "invalid", "{}"])
      expect(getReaderPanelLayout("toString", raw)).toEqual({ tocOpen: false, notesOpen: false });
  });
  test("simultaneous host writers preserve independent book records", async () => {
    const first = updateReaderPanelLayout("book", (p) => ({ ...p, tocOpen: true }));
    const second = updateReaderPanelLayout("other", (p) => ({ ...p, notesOpen: false }));
    await flush();
    expect(pending).toHaveLength(1);
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    await first;
    expect(JSON.parse(pending[0].value)).toEqual({
      book: { tocOpen: true, notesOpen: false },
      other: { tocOpen: true, notesOpen: false },
    });
    await act(async () => {
      pending.shift()!.commit();
      await tick();
    });
    await second;
  });
  test("panel and Ask AI intents reveal through one owner and deduplicate without leaking book scope", async () => {
    hold = false;
    const store = getDefaultStore();
    await act(async () => {
      store.set(readerPanelIntentAtom, { id: "appearance", bookId: "book", panel: "appearance" });
      await tick();
    });
    await flush();
    expect(readerPanels.snapshot()?.panels.appearance).toEqual({ open: true, visible: true });
    const hide = begin(() => readingRuntime.setControls(false));
    await flush();
    await hide;
    await act(async () => {
      store.set(askAiRequestAtom, { id: "ask", bookId: "book" });
      await tick();
    });
    await flush();
    expect(readerPanels.snapshot()?.panels.chat).toEqual({ open: true, visible: true });
    expect(state.chatFocusRequestId).toBe(1);
    await act(async () => {
      store.set(askAiRequestAtom, { id: "ask", bookId: "book" });
      render();
      await tick();
    });
    expect(state.chatFocusRequestId).toBe(1);
    await act(async () => {
      store.set(readerPanelIntentAtom, { id: "other", bookId: "other", panel: "annotations" });
      await tick();
    });
    expect(state.annotations).toBe(false);
    expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(0);
  });
  test("initial intents survive StrictMode effect replay and wait for the ready binding", async () => {
    hold = false;
    await act(async () => {
      root.unmount();
      readingRuntime.closed();
    });
    getDefaultStore().set(readerPanelIntentAtom, { id: "before-mount", bookId: "book", panel: "appearance" });
    open("book");
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      render();
      await tick();
    });
    await flush();
    expect(readerPanels.snapshot()?.panels.appearance).toEqual({ open: true, visible: true });
    await act(async () => {
      root.unmount();
      readingRuntime.closed();
    });
    getDefaultStore().set(readerPanelIntentAtom, { id: "before-ready", bookId: "book", panel: "annotations" });
    sessionId = readingRuntime.begin("book");
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      render();
      await tick();
    });
    expect(readerPanels.snapshot()).toBeNull();
    const at = { bookId: "book", contentVersion: "v1", cfi: "start" };
    await act(async () => {
      readingRuntime.attach(sessionId, { navigate: async () => at, step: async () => at }, at);
      await tick();
    });
    await flush();
    expect(readerPanels.snapshot()?.panels.annotations).toEqual({ open: true, visible: true });
    expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(0);
  });
  test("a completed panel request is not replayed when the same book is reopened", async () => {
    hold = false;
    await act(async () => {
      getDefaultStore().set(askAiRequestAtom, { id: "completed-ask", bookId: "book" });
      await tick();
    });
    await flush();
    expect(state.chat).toBe(true);
    const close = requestPanel("chat", false);
    await flush();
    await close;
    await act(async () => {
      root.unmount();
      readingRuntime.closed();
    });
    open("book");
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      render();
      await tick();
    });
    await flush();
    expect(state.chat).toBe(false);
    expect(state.chatFocusRequestId).toBe(0);
    expect(readerPanels.snapshot()?.controlsVisible).toBe(false);
  });
  test("public all/book plugin reactions retain one cause through chrome, optimistic view, durable layout and receipt", async () => {
    hold = false;
    for (const mode of ["all", "book"] as const) {
      const runtime = buildPluginContext(
        {
          id: `panel-${mode}`,
          name: "Panel",
          version: "1",
          schemaVersion: 1,
          requires: {},
          permissions: ["reading:write", "library:read"],
        },
        "1",
        [],
        mode === "book" ? { mode, bookId: "book" } : { mode },
      );
      runtime.lifecycle.promote();
      const observations: object[] = [],
        commits: object[] = [];
      const stop = readerPanels.observe((value) => {
        if (value) observations.push(value);
      });
      const stopCommit = onLocalKVCommit((commit) => {
        if (commit.entries.some((entry) => entry.key === key)) commits.push(commit);
      });
      try {
        const incoming = stampEventCause({}, causalActor("user"));
        await runtime.reactions.deliver({}, incoming, async (reaction) => {
          const origin = runtime.reactions.actor(reaction);
          const bound = runtime.context.withEvent({ reaction });
          await Promise.resolve();
          const request = begin(() => bound.services.ui.reader!.setPanel!("toc", true));
          await flush();
          const receipt = await request;
          expect(eventCause(receipt.snapshot)!.root).toBe(actorCause(origin)!.root);
          expect(eventCause(commits.at(-1)!)!.root).toBe(actorCause(origin)!.root);
          expect(eventCause(readingRuntime.snapshot())!.root).toBe(actorCause(origin)!.root);
          const cause = eventCause(observations.at(-1)!)!;
          const chat = begin(() => bound.services.ui.reader!.setPanel!("chat", true));
          await flush();
          await chat;
          expect(actorCause(state.chatFocusOrigin)).toBe(actorCause(origin));
          expect(cause.root).toBe(actorCause(origin)!.root);
          expect(() => reactionActor(`plugin:panel-${mode}`, actorCause(origin)!.steps[0]!, cause)).toThrow(
            expect.objectContaining({ code: "plugin/event-cycle" }),
          );
        });
        const previous = eventCause(readerPanels.snapshot()!)!.root;
        const close = requestPanel("toc", false);
        await flush();
        await close;
        expect(eventCause(readerPanels.snapshot()!)!.root).not.toBe(previous);
      } finally {
        stop();
        stopCommit();
        runtime.lifecycle.stop();
        await runtime.lifecycle.drainCleanups();
      }
    }
  });
  test("public panel observations stop a cross-plugin cycle and accept another independent user intent", async () => {
    hold = false;
    for (const mode of ["all", "book"] as const) {
      const make = (id: string) => {
        const runtime = buildPluginContext(
          { id, name: id, version: "1", schemaVersion: 1, requires: {}, permissions: ["reading:write"] },
          "1",
          [],
          mode === "all" ? { mode } : { mode, bookId: "book" },
        );
        runtime.lifecycle.promote();
        return runtime;
      };
      const a = make(`panels-a-${mode}`),
        b = make(`panels-b-${mode}`),
        errors: unknown[] = [];
      let cycles = 0;
      // The next reaction can replace a command after its optimistic render
      // and before its durable/render acknowledgement. That receipt must stay
      // superseded; the final view and disk below prove the actual effects.
      const superseded = (error: unknown) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "reader/superseded")) throw error;
      };
      try {
        a.context.services.ui.reader!.observe(async (value, delivery) => {
          try {
            if (!value) return;
            if (!value.panels.toc.open && value.panels.chat.open) {
              expect(delivery?.reaction?.status).toBe("cycle");
              cycles++;
              expect(() => a.context.withEvent(delivery)).toThrow(
                expect.objectContaining({ code: "plugin/event-cycle" }),
              );
            } else if (value.panels.toc.open && !value.panels.chat.open && delivery?.reaction?.status !== "cycle") {
              const bound = a.context.withEvent(delivery);
              await Promise.resolve();
              await bound.services.ui.reader!.setPanel!("chat", true).catch(superseded);
            }
          } catch (error) {
            errors.push(error);
          }
        });
        b.context.services.ui.reader!.observe(async (value, delivery) => {
          try {
            if (!value || !value.panels.toc.open || !value.panels.chat.open || delivery?.reaction?.status === "cycle")
              return;
            const bound = b.context.withEvent(delivery);
            await Promise.resolve();
            await bound.services.ui.reader!.setPanel!("toc", false).catch(superseded);
          } catch (error) {
            errors.push(error);
          }
        });
        for (let n = 0; n < 2; n++) {
          const request = requestPanel("toc", true).catch(superseded);
          await flush();
          await request;
          await act(async () => {
            await Promise.all([a.reactions.drain(), b.reactions.drain()]);
          });
          expect(errors).toEqual([]);
          expect(cycles).toBe(n + 1);
          expect(readerPanels.snapshot()?.panels).toMatchObject({ toc: { open: false }, chat: { open: true } });
          expect(JSON.parse(disk.get(key)!).book).toEqual({ tocOpen: false, notesOpen: true });
          const close = requestPanel("chat", false);
          await flush();
          await close;
        }
      } finally {
        a.lifecycle.stop();
        b.lifecycle.stop();
        await Promise.all([a.lifecycle.drainCleanups(), b.lifecycle.drainCleanups()]);
      }
    }
  });
  test("width failure and transient panel feedback retain their source; independent control hiding has its own root", async () => {
    const origin = causalActor("plugin:panels");
    const width = begin(() => readerPanels.setWidth("toc", 450, undefined, undefined, origin)).catch((error) => error);
    await flush();
    expect(eventCause(readerPanels.snapshot()!)!.root).toBe(actorCause(origin)!.root);
    await act(async () => {
      pending.shift()!.reject({ code: "db/locked", message: "failed" });
      await tick();
    });
    await width;
    expect(readerPanels.snapshot()?.sizes.toc).toBe(288);
    expect(eventCause(readerPanels.snapshot()!)!.root).toBe(actorCause(origin)!.root);
    const transient = requestPanel("appearance", true, undefined, undefined, origin);
    await flush();
    await transient;
    expect(eventCause(readerPanels.snapshot()!)!.root).toBe(actorCause(origin)!.root);
    const user = causalActor("user");
    const hide = begin(() => readingRuntime.setControls(false, undefined, undefined, user));
    await flush();
    await hide;
    expect(readerPanels.snapshot()?.panels.appearance.open).toBe(false);
    expect(eventCause(readerPanels.snapshot()!)!.root).toBe(actorCause(user)!.root);
  });
  test("reentrant KV mirrors never relabel the latest rendered value with an older notification", async () => {
    hold = false;
    const first = causalActor("plugin:first"),
      second = causalActor("plugin:second");
    let newer: Promise<void> | undefined;
    const stop = onLocalKVChange((changedKey, value) => {
      if (changedKey === key && value?.includes('"tocOpen":true') && !newer)
        newer = localKV.setItemAsync(key, JSON.stringify({ book: { tocOpen: false, notesOpen: true } }), second);
    });
    const seen: DomainActor[] = [];
    const stopAfter = onLocalKVChange((changedKey, _value, origin) => {
      if (changedKey === key) seen.push(origin);
    });
    try {
      await act(async () => {
        await localKV.setItemAsync(key, JSON.stringify({ book: { tocOpen: true, notesOpen: false } }), first);
        await newer;
        await tick();
      });
      expect(seen).toEqual([second]);
      expect(readerPanels.snapshot()?.panels.chat.open).toBe(true);
      expect(eventCause(readerPanels.snapshot()!)!.root).toBe(actorCause(second)!.root);
    } finally {
      stop();
      stopAfter();
    }
  });
} else {
  test("isolated shared panel service, persistence and React lifecycle cases", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PANEL_LAYOUT_CASE: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("21 pass");
  }, 30_000);
}
