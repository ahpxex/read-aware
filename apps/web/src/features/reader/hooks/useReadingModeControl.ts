import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import { useLocale } from "../../../i18n";
import { textUnitModeSettingsAtom } from "../../../state/ui";
import { readingRuntime } from "../../../domain/reading-runtime";
import { textUnitReaderModeAtom } from "../../plugins/state/plugin-store";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { ReadingModeController } from "../lib/reading-mode-controller";
import { readTextUnitModeState, readTextUnitModeSettings, updateTextUnitModeSettings, writeTextUnitModeState, isTextUnitModeStateCompatible } from "../lib/text-unit-mode-state";

/** One mode owner for native controls and both external actors. */
export function useReadingModeControl(bookId: string, supported: boolean) {
  const mode = useAtomValue(textUnitReaderModeAtom);
  const settings = useAtomValue(textUnitModeSettingsAtom);
  const locale = useLocale();
  const controller = useMemo(() => {
    const saved = readTextUnitModeState(bookId);
    return new ReadingModeController(saved.active, settings.unitId ?? saved.unitId);
  }, [bookId]);
  const request = useSyncExternalStore(controller.observe, controller.requested);
  const descriptor = useMemo(() => mode ? {
    key: mode.key, label: resolvePluginText(mode.copy.title, locale), defaultUnitId: mode.defaultUnitId,
    units: mode.units.map(unit => ({ id: unit.id, label: resolvePluginText(unit.label, locale) })),
  } : null, [mode, locale]);
  const retire = useCallback(() => {
    const key = controller.snapshot().modeKey;
    if (!controller.retire()) return;
    const request = controller.requested();
    const saved = readTextUnitModeState(bookId);
    // The navigator may already be unmounting. Persist cancellation here so a
    // rejected start cannot silently resume when this book is opened again.
    writeTextUnitModeState(bookId, { ...saved, active: request.active, modeKey: key, unitId: request.unitId,
      resting: request.active && key && request.unitId && isTextUnitModeStateCompatible(saved, key, request.unitId, saved.contentVersion) ? saved.resting : null });
    if (key && request.unitId && readTextUnitModeSettings(key).unitId !== request.unitId) updateTextUnitModeSettings(key, { unitId: request.unitId });
  }, [bookId, controller]);
  useEffect(() => {
    controller.environment(descriptor, supported);
    return retire;
  }, [controller, descriptor, supported, retire]);

  const previousPreference = useRef({ key: mode?.key, unitId: settings.unitId });
  useEffect(() => {
    const changed = previousPreference.current.key !== mode?.key || previousPreference.current.unitId !== settings.unitId;
    previousPreference.current = { key: mode?.key, unitId: settings.unitId };
    // An earlier subscriber may already have committed a newer preference.
    const unitId = readTextUnitModeSettings(mode?.key ?? null).unitId;
    if (changed && unitId && descriptor?.units.some(unit => unit.id === unitId)
      && controller.requested().unitId !== unitId) controller.choose(controller.requested().active, unitId);
  }, [controller, descriptor, mode?.key, settings.unitId]);
  useEffect(() => {
    if (!mode) return;
    let persisted: ReturnType<ReadingModeController["requested"]> | undefined;
    const persist = () => {
      const requested = controller.requested();
      if (requested === persisted || controller.snapshot().modeKey !== mode.key) return;
      persisted = requested;
      const unitId = requested.unitId;
      if (unitId && mode.units.some(unit => unit.id === unitId) && readTextUnitModeSettings(mode.key).unitId !== unitId) {
        updateTextUnitModeSettings(mode.key, { unitId });
      }
    };
    // Persist the current request, never the request captured by an older render.
    persist();
    return controller.observe(persist);
  }, [controller, mode]);

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
  return { controller, request, mode, setActive, setUnit };
}
