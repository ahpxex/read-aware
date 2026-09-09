import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import { useLocale } from "../../../i18n";
import { textUnitModeSettingsAtom } from "../../../state/ui";
import { readingRuntime } from "../../../domain/reading-runtime";
import { afterLocalKVWrites } from "../../../platform/local-store";
import { readerModesAtom, setActiveReaderMode, releaseActiveReaderMode } from "../../plugins/state/plugin-store";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { ReadingModeController } from "../lib/reading-mode-controller";
import { readTextUnitModeState, readTextUnitModeSettings, writeTextUnitModeConfiguration, isTextUnitModeStateCompatible } from "../lib/text-unit-mode-state";

/** One mode owner for native controls and both external actors. */
export function useReadingModeControl(bookId: string, supported: boolean) {
  const modes = useAtomValue(readerModesAtom);
  const settings = useAtomValue(textUnitModeSettingsAtom);
  const locale = useLocale();
  const controller = useMemo(() => {
    const saved = readTextUnitModeState(bookId);
    const controller = new ReadingModeController(saved.active, saved.modeKey ? readTextUnitModeSettings(saved.modeKey).unitId ?? saved.unitId : saved.unitId,
      35_000, saved.modeKey, key => readTextUnitModeSettings(key).unitId);
    controller.requireDurability();
    return controller;
  }, [bookId]);
  const request = useSyncExternalStore(controller.observe, controller.requested);
  const snapshot = useSyncExternalStore(controller.observe, controller.snapshot);
  const mode = modes.find(mode => mode.kind === "text-unit-navigator" && mode.key === request.modeKey) ?? null;
  const descriptors = useMemo(() => modes.filter(mode => mode.kind === "text-unit-navigator").map(mode => ({
    key: mode.key, label: `${mode.pluginName}: ${resolvePluginText(mode.copy.title, locale)}`, defaultUnitId: mode.defaultUnitId,
    units: mode.units.map(unit => ({ id: unit.id, label: resolvePluginText(unit.label, locale) })),
    implementation: mode.segmentText,
  })), [modes, locale]);
  const persistRequest = useCallback(() => {
    const requested = controller.requested();
    controller.trackConfiguration(requested.revision, afterLocalKVWrites(() => {
      if (controller.requested() !== requested) return;
      const { modeKey: key, unitId } = requested;
      const saved = readTextUnitModeState(bookId);
      return writeTextUnitModeConfiguration(bookId, {
        ...saved, active: requested.active, modeKey: key, unitId,
        resting: requested.active && key && unitId && isTextUnitModeStateCompatible(saved, key, unitId, saved.contentVersion) ? saved.resting : null,
      }, controller.snapshot().units.some(unit => unit.id === unitId));
    }));
  }, [bookId, controller]);
  const retire = useCallback(() => {
    // The navigator/subscription may already be unmounting. Retain cancellation.
    if (controller.retire()) persistRequest();
  }, [controller, persistRequest]);
  useEffect(() => {
    controller.environment(descriptors, supported);
  }, [controller, descriptors, supported]);
  useEffect(() => {
    const publish = () => setActiveReaderMode(controller, controller.requested().modeKey);
    publish();
    const off = controller.observe(publish);
    return () => { off(); releaseActiveReaderMode(controller); };
  }, [controller]);

  const previousPreference = useRef({ key: mode?.key, unitId: settings.unitId });
  useEffect(() => {
    // Selecting a provider already resolves its preference in the controller.
    // An old preference must not override an explicit unit in that same intent.
    const changed = previousPreference.current.key === mode?.key && previousPreference.current.unitId !== settings.unitId;
    previousPreference.current = { key: mode?.key, unitId: settings.unitId };
    if (changed) void controller.reconcilePreference(() => readTextUnitModeSettings(mode?.key ?? null).unitId);
  }, [controller, mode, settings.unitId]);
  useEffect(() => {
    let persisted: ReturnType<ReadingModeController["requested"]> | undefined;
    const persist = () => {
      const requested = controller.requested();
      if (requested === persisted) return;
      persisted = requested;
      persistRequest();
    };
    // Persist the current request, never the request captured by an older render.
    persist();
    return controller.observe(persist);
  }, [controller, persistRequest]);

  useEffect(() => {
    let sessionId: string | null = null;
    let release: (() => void) | undefined;
    const unobserve = readingRuntime.observe(state => {
      const id = state.bookId === bookId && state.status === "ready" ? state.sessionId : null;
      if (id === sessionId) return;
      sessionId = id;
      release?.(); release = undefined;
      if (id) release = readingRuntime.bindMode(id, { snapshot: controller.snapshot, observe: controller.observe, generation: controller.generation,
        waitForPosition: (position, signal) => controller.waitForPosition(position, signal),
        step: (direction, signal) => controller.step(direction, signal),
        configure: (input, signal) => controller.configure(input, signal), retire });
    });
    return () => { unobserve(); release?.(); retire(); };
  }, [bookId, controller, retire]);

  const setActive = useCallback((active: boolean) => controller.choose(active), [controller]);
  const setUnit = useCallback((unitId: string) => controller.choose(controller.requested().active, unitId), [controller]);
  return { controller, request, snapshot, mode, setActive, setUnit };
}
