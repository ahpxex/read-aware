import { expect, mock, test } from "bun:test";
import { act, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import type { ReaderSettings } from "../../settings/lib/reader-settings";
import type { FoliateRenderer, FoliateView } from "../lib/foliate-engine";
import { actorCause, causalActor, eventCause, stampEventCause } from "../../../platform/domain-actor";
import { readingRenderActor } from "../lib/reading-render-context";

if (process.env.READER_TYPOGRAPHY_CASE === "1") {
  // `waiting` stands in for a font's download, `stored` for faces already on this device.
  const waiting = new Map<string, Promise<string>>(),
    stored = new Map<string, string>();
  mock.module("../../settings/lib/curated-font-loader", () => ({
    ensureCuratedFontFaceCss: (id: string) => waiting.get(id) ?? Promise.resolve(""),
    localCuratedFontFaceCss: (id: string) => Promise.resolve(stored.get(id) ?? null),
  }));
  const { useReaderTypography } = await import("./useReaderTypography");
  const { useReaderAppearance } = await import("./useReaderAppearance");
  const { useReaderEngineLoadSource } = await import("./useReaderEngineLoadSource");
  const { readingRuntime } = await import("../../../domain/reading-runtime");
  const { attachReadingEngine } = await import("../lib/reading-engine-adapter");
  const { useAppearance } = await import("../../settings/hooks/useAppearance");
  const { DEFAULT_READER_PREFERENCES, READER_PREFERENCES_KEY } = await import("../../settings/lib/reader-settings");
  const { READER_OVERRIDES_KEY } = await import("../../settings/lib/reader-overrides");
  const { APP_SETTINGS_KEY } = await import("../../settings/lib/app-settings");
  const { localKV, flushLocalKV, onLocalKVCommit } = await import("../../../platform/local-store");
  const { buildPluginContext } = await import("../../plugins/runtime/plugin-context");
  const { getDefaultStore } = await import("jotai");
  const { appSettingsAtom } = await import("../../../state/ui");
  const { emitAppEvent } = await import("../../../platform/app-events");
  const { registerFontContribution, registerThemeContribution, markPluginsReady } = await import(
    "../../plugins/state/plugin-store"
  );
  const { BUILTIN_READER_PALETTES } = await import("../../settings/lib/reader-theme");
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("public settings reactions reach CSS and layout through native KV and the committed appearance projection", async () => {
    const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    const values = {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    const saved = Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(values))
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    let heldWrite: ReturnType<typeof Promise.withResolvers<void>> | undefined;
    Object.assign(dom.window, {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      __TAURI_INTERNALS__: {
        invoke(command: string) {
          if (command === "local_device_get")
            return Promise.resolve({ deviceId: "typography", lastHlcWallMs: null, lastHlcCounter: null });
          if (command === "desktop_startup_enabled") return Promise.resolve(false);
          if (command === "set_kv_batch" && heldWrite) return heldWrite.promise;
          return Promise.resolve();
        },
      },
    });
    const root = createRoot(dom.window.document.getElementById("root")!);
    const rendered: { css: string; context: object }[] = [],
      layouts: object[] = [],
      pageColors: object[] = [];
    const renderer = {
      setStyles(css: string, context: object) {
        rendered.push({ css, context });
      },
      getContents() {
        return [];
      },
      setPageColors(_colors: object, context: object) {
        pageColors.push(context);
      },
      setLayoutAttributes(_values: object, context: object) {
        layouts.push(context);
      },
    } as unknown as FoliateRenderer;
    const events = new EventTarget();
    const viewRef = {
        current: {
          renderer,
          lastLocation: { cfi: "current", fraction: 0.5, section: { current: 0, total: 1 } },
          addEventListener: events.addEventListener.bind(events),
          removeEventListener: events.removeEventListener.bind(events),
        } as unknown as FoliateView,
      },
      viewportRef = { current: dom.window.document.body };
    // Never prepared here: this harness only needs the book's identity.
    const loadedBook = { fileName: "book.epub", format: "epub" as const, content: new Promise<never>(() => {}) };
    const sessionId = readingRuntime.begin("book", undefined, causalActor("user"));
    let engineSource!: ReturnType<typeof useReaderEngineLoadSource>;
    const retirements: object[] = [];
    let appearance!: ReturnType<typeof useReaderAppearance>, typography!: ReturnType<typeof useReaderTypography>;
    const layoutForReadingMode = () => ({ maxColumnCount: 1 });
    const isFixedLayoutRef = { current: false },
      readingModeRef = { current: "scroll" as const };
    function Harness() {
      useAppearance();
      const readerAppearance = useReaderAppearance("book");
      appearance = readerAppearance;
      engineSource = useReaderEngineLoadSource(
        loadedBook,
        "book",
        readerAppearance.effective.readingMode,
        readerAppearance.effective,
      );
      const readingMode = readerAppearance.effective.readingMode;
      useEffect(() => {
        const detach = attachReadingEngine(
          viewRef.current,
          sessionId,
          "book",
          "version",
          "version",
          engineSource.current!.origin,
        );
        return () => {
          retirements.push(stampEventCause({}, engineSource.current!.origin));
          detach(engineSource.current!.origin);
        };
      }, [readingMode]);
      typography = useReaderTypography({
        readerSettings: appearance.effective,
        viewRef,
        readerRootRef: viewportRef,
        viewportRef,
        isFixedLayoutRef,
        readingModeRef,
        layoutForReadingMode,
      });
      return null;
    }
    const runtime = buildPluginContext(
      {
        id: "typography",
        name: "Typography",
        version: "1",
        schemaVersion: 1,
        requires: {},
        settingsAccess: { read: ["reading.*", "appearance.*"], write: ["reading.*", "appearance.*"] },
      },
      "1",
      [],
    );
    const contributions: { dispose(): void }[] = [];
    const skinCommits: object[] = [];
    const offSkinCommit = onLocalKVCommit((commit) => {
      if (commit.entries.some((entry) => entry.key === "read-aware-app-skin")) skinCommits.push(commit);
    });
    runtime.lifecycle.promote();
    markPluginsReady();
    try {
      await localKV.setItemAsync(
        READER_PREFERENCES_KEY,
        JSON.stringify({ ...DEFAULT_READER_PREFERENCES, fontFamily: "system:Arial", theme: "auto" }),
      );
      await localKV.setItemAsync(READER_OVERRIDES_KEY, "{}");
      await localKV.setItemAsync(APP_SETTINGS_KEY, JSON.stringify({ theme: "light", motion: "system" }));
      await act(async () => {
        root.render(
          <StrictMode>
            <Harness />
          </StrictMode>,
        );
        await tick();
      });
      expect(eventCause(readingRuntime.snapshot())?.root).toBe(
        actorCause(readingRuntime.openingActor(sessionId))?.root,
      );
      const originalLoad = engineSource.current;
      for (const target of [{ kind: "global" }, { kind: "book", bookId: "book" }] as const) {
        await runtime.reactions.deliver({}, stampEventCause({}, causalActor("user")), async (reaction) => {
          const bound = runtime.context.withEvent({ reaction }),
            origin = runtime.reactions.actor(reaction);
          await act(async () => {
            await bound.domains.settings.commands.update([
              { path: "reading.fontSize", value: target.kind === "global" ? "large" : "x-large", target },
            ]);
            await tick();
          });
          expect(eventCause(appearance.effective)?.root).toBe(actorCause(origin)!.root);
          expect(actorCause(readingRenderActor(rendered.at(-1)!.context))?.steps).toEqual(actorCause(origin)!.steps);
          expect(actorCause(readingRenderActor(layouts.at(-1)!))?.root).toBe(actorCause(origin)!.root);
        });
      }
      // An unrelated book's stored override cannot repaint this reader or
      // smuggle another root into its next automatic response.
      const current = appearance.effective,
        count = rendered.length;
      await act(async () => {
        await runtime.context.domains.settings.commands.update([
          { path: "reading.fontSize", value: "xx-large", target: { kind: "book", bookId: "other" } },
        ]);
        await tick();
      });
      expect(appearance.effective).toBe(current);
      expect(rendered.length).toBe(count);
      await act(async () => {
        appearance.setScope("global");
        await flushLocalKV();
        await tick();
      });
      expect(appearance.effective.fontSize).toBe("large");
      expect(eventCause(appearance.effective)?.steps).toEqual([]);
      await runtime.reactions.deliver({}, stampEventCause({}, causalActor("user")), async (reaction) => {
        const origin = runtime.reactions.actor(reaction);
        await act(async () => {
          await runtime.context
            .withEvent({ reaction })
            .domains.settings.commands.update([{ path: "appearance.theme", value: "dark" }]);
          await tick();
        });
        expect(appearance.effective.theme).toBe("dark");
        expect(actorCause(readingRenderActor(rendered.at(-1)!.context))?.root).toBe(actorCause(origin)!.root);
      });
      const currentAppSettings = getDefaultStore().get(appSettingsAtom);
      await act(async () => {
        emitAppEvent("roaming-preferences-changed", { keys: [APP_SETTINGS_KEY] });
        await tick();
      });
      expect(getDefaultStore().get(appSettingsAtom)).toBe(currentAppSettings);
      expect(engineSource.current).toBe(originalLoad);
      // A real public settings reaction rebuilds this same session, preserving
      // its cause through outgoing cleanup and the adapter's ready/relocate.
      const rule = {};
      await runtime.reactions.deliver(rule, stampEventCause({}, causalActor("user")), async (reaction) => {
        const actor = runtime.reactions.actor(reaction);
        const next = appearance.effective.readingMode === "scroll" ? "paginated-single" : "scroll";
        await act(async () => {
          await runtime.context
            .withEvent({ reaction })
            .domains.settings.commands.update([
              { path: "reading.readingMode", value: next, target: { kind: "global" } },
            ]);
          await tick();
        });
        expect(eventCause(retirements.at(-1)!)?.root).toBe(actorCause(actor)?.root);
        expect(eventCause(readingRuntime.snapshot())?.steps).toEqual(actorCause(actor)?.steps);
        expect(eventCause(readingRuntime.snapshot())?.root).toBe(actorCause(actor)?.root);
        expect(readingRuntime.snapshot().status).toBe("ready");
        expect(readingRuntime.snapshot().sessionId).toBe(sessionId);
      });
      await runtime.reactions.deliver(rule, readingRuntime.snapshot(), (reaction) => {
        expect(reaction.status).toBe("cycle");
        expect(() => runtime.reactions.actor(reaction)).toThrow(
          expect.objectContaining({ code: "plugin/event-cycle" }),
        );
      });
      const reactedRoot = eventCause(readingRuntime.snapshot())!.root;
      await act(async () => {
        appearance.updatePrefs({
          ...appearance.prefs,
          readingMode: appearance.effective.readingMode === "scroll" ? "paginated-single" : "scroll",
        });
        await flushLocalKV();
        await tick();
      });
      expect(eventCause(readingRuntime.snapshot())?.root).not.toBe(reactedRoot);
      await runtime.reactions.deliver(rule, readingRuntime.snapshot(), (reaction) => {
        expect(reaction.status).not.toBe("cycle");
      });
      await runtime.reactions.deliver({}, stampEventCause({}, causalActor("user")), async (reaction) => {
        const origin = runtime.reactions.actor(reaction),
          previousSize = appearance.effective.fontSize;
        heldWrite = Promise.withResolvers<void>();
        let failed!: Promise<unknown>;
        await act(async () => {
          failed = runtime.context
            .withEvent({ reaction })
            .domains.settings.commands.update([
              { path: "reading.fontSize", value: "xxx-large", target: { kind: "global" } },
            ])
            .catch((error) => error);
          await tick();
        });
        expect(appearance.effective.fontSize).toBe("xxx-large");
        await act(async () => {
          heldWrite!.reject({ code: "db/locked", message: "Controlled write failure" });
          expect(await failed).toMatchObject({ code: "db/locked" });
          heldWrite = undefined;
          await tick();
        });
        expect(appearance.effective.fontSize).toBe(previousSize);
        expect(actorCause(readingRenderActor(rendered.at(-1)!.context))?.root).toBe(actorCause(origin)!.root);
      });
      const font = {
        id: "serif",
        key: "typography:serif",
        pluginId: "typography",
        pluginName: "Typography",
        name: "Serif",
        family: "Selected Serif",
        files: [{ path: "font.woff2" }],
      };
      const skin = {
        id: "skin",
        key: "typography:skin",
        pluginId: "typography",
        pluginName: "Typography",
        name: "Skin",
        polarity: "dark" as const,
        app: { paper: "#101010" },
        reader: { palette: BUILTIN_READER_PALETTES.dark },
      };
      let selectedFont!: ReturnType<typeof registerFontContribution>,
        selectedTheme!: ReturnType<typeof registerThemeContribution>;
      await act(async () => {
        selectedFont = registerFontContribution(font);
        selectedTheme = registerThemeContribution(skin);
        contributions.push(selectedFont, selectedTheme);
        await runtime.context.domains.settings.commands.update([
          { path: "reading.fontFamily", value: "plugin:typography:serif", target: { kind: "global" } },
          { path: "reading.theme", value: "plugin:typography:skin", target: { kind: "global" } },
          { path: "appearance.theme", value: "plugin:typography:skin" },
        ]);
        await tick();
      });
      expect(rendered.at(-1)!.css).toContain("Selected Serif");
      const typographyRule = {};
      await runtime.reactions.deliver(typographyRule, stampEventCause({}, causalActor("user")), async (reaction) => {
        const origin = runtime.reactions.actor(reaction);
        await act(async () => {
          // Replacement can preserve the exact value while changing ownership.
          selectedFont = registerFontContribution(font, origin);
          contributions.push(selectedFont);
          contributions.push(
            registerFontContribution({ ...font, key: "other:serif", pluginId: "other" }, causalActor("user")),
          );
          await tick();
        });
        expect(actorCause(readingRenderActor(rendered.at(-1)!.context))).toBe(actorCause(origin));
        await runtime.reactions.deliver(
          typographyRule,
          stampEventCause({}, readingRenderActor(rendered.at(-1)!.context)),
          (repeated) => {
            expect(repeated.status).toBe("cycle");
          },
        );
        await act(async () => {
          selectedFont.dispose(origin);
          contributions.push(
            registerFontContribution({ ...font, key: "other:second", pluginId: "other", id: "second" }),
          );
          await tick();
        });
        expect(rendered.at(-1)!.css).not.toContain("@font-face");
        expect(actorCause(readingRenderActor(rendered.at(-1)!.context))).toBe(actorCause(origin));
      });
      const countBeforeUnrelated = rendered.length;
      await act(async () => {
        contributions.push(registerThemeContribution({ ...skin, key: "other:skin", pluginId: "other" }));
        await tick();
      });
      expect(rendered).toHaveLength(countBeforeUnrelated);
      await runtime.reactions.deliver(typographyRule, stampEventCause({}, causalActor("user")), async (reaction) => {
        expect(reaction.status).toBe("ready");
        const origin = runtime.reactions.actor(reaction);
        await act(async () => {
          selectedTheme = registerThemeContribution(
            { ...skin, polarity: "light", reader: { palette: BUILTIN_READER_PALETTES.light } },
            origin,
          );
          contributions.push(selectedTheme);
          await tick();
        });
        expect(dom.window.document.documentElement.dataset.theme).toBe("light");
        expect(actorCause(readingRenderActor(rendered.at(-1)!.context))).toBe(actorCause(origin));
        expect(actorCause(readingRenderActor(pageColors.at(-1)!))).toBe(actorCause(origin));
        // Auto reader color follows the resolved app theme with the same source.
        await act(async () => {
          await runtime.context.domains.settings.commands.update([
            { path: "reading.theme", value: "auto", target: { kind: "global" } },
          ]);
          await tick();
        });
        await act(async () => {
          selectedTheme = registerThemeContribution(skin, origin);
          contributions.push(selectedTheme);
          await tick();
        });
        expect(appearance.effective.theme).toBe("dark");
        expect(actorCause(readingRenderActor(rendered.at(-1)!.context))).toBe(actorCause(origin));
        expect(eventCause(skinCommits.at(-1)!)).toBe(actorCause(origin));
        await act(async () => {
          selectedTheme.dispose(origin);
          await tick();
        });
        expect(dom.window.document.documentElement.dataset.theme).toBe("light");
        expect(appearance.effective.theme).toBe("warm");
        expect(actorCause(readingRenderActor(rendered.at(-1)!.context))).toBe(actorCause(origin));
        expect(eventCause(skinCommits.at(-1)!)).toBe(actorCause(origin));
      });
      // A font already on this device ships in the one stylesheet the request
      // resolves with. One that must download styles the book in the fallback
      // stack at once and swaps its faces in when they land — unless a newer
      // request owns the stylesheet by then.
      stored.set("literata", "/* stored literata */");
      let styledCount = rendered.length;
      await typography.injectStyles(
        stampEventCause({ ...appearance.effective, fontFamily: "curated:literata" } as ReaderSettings),
      );
      expect(rendered.length).toBe(styledCount + 1);
      expect(rendered.at(-1)!.css).toContain("/* stored literata */");
      const download = Promise.withResolvers<string>();
      waiting.set("inter", download.promise);
      styledCount = rendered.length;
      await typography.injectStyles(
        stampEventCause({ ...appearance.effective, fontFamily: "curated:inter" } as ReaderSettings),
      );
      expect(rendered.length).toBe(styledCount + 1);
      expect(rendered.at(-1)!.css).not.toContain("@font-face");
      download.resolve("/* downloaded inter */");
      await tick();
      expect(rendered.length).toBe(styledCount + 2);
      expect(rendered.at(-1)!.css).toContain("/* downloaded inter */");
      const overtaken = Promise.withResolvers<string>();
      waiting.set("inter", overtaken.promise);
      await typography.injectStyles(
        stampEventCause({ ...appearance.effective, fontFamily: "curated:inter" } as ReaderSettings),
      );
      await typography.injectStyles(stampEventCause({ ...appearance.effective, fontFamily: "system:Georgia" }));
      styledCount = rendered.length;
      overtaken.resolve("/* overtaken inter */");
      await tick();
      expect(rendered.length).toBe(styledCount);
      const slow = Promise.withResolvers<string>(),
        source = causalActor("plugin:slow-font");
      waiting.set("inter", slow.promise);
      const oldSettings = stampEventCause(
        { ...appearance.effective, fontFamily: "curated:inter" } as ReaderSettings,
        source,
      );
      const old = typography.injectStyles(oldSettings);
      const latest = causalActor("user");
      await typography.injectStyles(stampEventCause({ ...appearance.effective, fontFamily: "system:Georgia" }, latest));
      const accepted = rendered.at(-1),
        before = rendered.length;
      slow.resolve("/* obsolete font */");
      await old;
      expect(rendered.length).toBe(before);
      expect(rendered.at(-1)).toBe(accepted);
      expect(actorCause(readingRenderActor(accepted!.context))?.root).toBe(actorCause(latest)!.root);
      const retired = Promise.withResolvers<string>();
      waiting.set("inter", retired.promise);
      const pending = typography.injectStyles(oldSettings);
      viewRef.current = {
        renderer: {
          setStyles() {
            throw Error("Old styles reached replacement renderer");
          },
        },
      } as unknown as FoliateView;
      retired.resolve("/* replaced reader */");
      await pending;
      expect(rendered.length).toBe(before);
      viewRef.current = { renderer } as FoliateView;
      const unmounted = Promise.withResolvers<string>();
      waiting.set("inter", unmounted.promise);
      const unmountedRequest = typography.injectStyles(oldSettings);
      await act(async () => root.unmount());
      unmounted.resolve("/* retired */");
      await unmountedRequest;
      expect(rendered.length).toBe(before);
    } finally {
      heldWrite?.resolve();
      await act(async () => root.unmount());
      runtime.lifecycle.stop();
      await runtime.lifecycle.drainCleanups();
      for (const contribution of contributions) contribution.dispose();
      offSkinCommit();
      readingRuntime.closed();
      waiting.clear();
      stored.clear();
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
} else {
  test("isolated reader appearance and asynchronous typography contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, READER_TYPOGRAPHY_CASE: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("1 pass");
  }, 30_000);
}
