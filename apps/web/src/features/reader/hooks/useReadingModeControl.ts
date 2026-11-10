import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import { useLocale } from "../../../i18n";
import { readingRuntime } from "../../../domain/reading-runtime";
import { afterLocalKVWrites, onLocalKVCommit } from "../../../platform/local-store";
import { actorFromEvent, causalActor, eventCause, type DomainActor } from "../../../platform/domain-actor";
import { pluginSettingsKey } from "../../plugins/lib/plugin-settings";
import { readerModesAtom, setActiveReaderMode, releaseActiveReaderMode } from "../../plugins/state/plugin-store";
import { selectContribution } from "../../plugins/state/contribution-registry";
import { useRegisteredContribution } from "../../plugins/hooks/useRegisteredContribution";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { ReadingModeController } from "../lib/reading-mode-controller";
import {
  readTextUnitModeState,
  readTextUnitModeSettings,
  ReadingModeConfigurationWrites,
  isTextUnitModeStateCompatible,
  textUnitModeStateKey,
} from "../lib/text-unit-mode-state";

/**
 * One mode owner for native controls and both external actors.
 *
 * `reading` is false while the reader only stands by with the book: nobody is
 * choosing a mode, so the mode is not published as the reader's, bound to the
 * reading runtime, reconciled or written. The controller is made anew when
 * reading starts, from what is stored then and for the session that started.
 */
export function useReadingModeControl(bookId: string, supported: boolean, reading = true) {
  const modes = useAtomValue(readerModesAtom);
  const locale = useLocale();
  const controller = useMemo(() => {
    const saved = readTextUnitModeState(bookId);
    const session = readingRuntime.snapshot();
    const origin =
      session.bookId === bookId && session.sessionId ? readingRuntime.openingActor(session.sessionId) : "system";
    const controller = new ReadingModeController(
      saved.active,
      saved.modeKey ? (readTextUnitModeSettings(saved.modeKey).unitId ?? saved.unitId) : saved.unitId,
      35_000,
      saved.modeKey,
      (key) => readTextUnitModeSettings(key).unitId,
      origin,
    );
    controller.requireDurability();
    return controller;
    // `reading`: a standing reader's controller is not carried into a session.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, reading]);
  const configurationWrites = useMemo(
    () => new ReadingModeConfigurationWrites(controller.configurationConfirmed),
    [controller],
  );
  const request = useSyncExternalStore(controller.observe, controller.requested);
  const snapshot = useSyncExternalStore(controller.observe, controller.snapshot);
  const selected = useRegisteredContribution(readerModesAtom, request.modeKey ?? "");
  const previousEnvironment = useRef<
    | { controller: ReadingModeController; modes: typeof modes; key: string | null; selected: typeof selected }
    | undefined
  >(undefined);
  const mode = modes.find((mode) => mode.kind === "text-unit-navigator" && mode.key === request.modeKey) ?? null;
  const descriptors = useMemo(
    () =>
      modes
        .filter((mode) => mode.kind === "text-unit-navigator")
        .map((mode) => ({
          key: mode.key,
          label: `${mode.pluginName}: ${resolvePluginText(mode.copy.title, locale)}`,
          defaultUnitId: mode.defaultUnitId,
          units: mode.units.map((unit) => ({ id: unit.id, label: resolvePluginText(unit.label, locale) })),
          implementation: selectContribution(readerModesAtom, mode.key).getSnapshot(),
        })),
    [modes, locale],
  );
  const persistRequest = useCallback(() => {
    const requested = controller.requested();
    controller.trackConfiguration(
      requested.revision,
      afterLocalKVWrites(() => {
        if (controller.requested() !== requested) return;
        const { modeKey: key, unitId } = requested;
        const saved = readTextUnitModeState(bookId);
        return configurationWrites.write(
          requested.revision,
          bookId,
          {
            ...saved,
            active: requested.active,
            modeKey: key,
            unitId,
            resting:
              requested.active &&
              key &&
              unitId &&
              isTextUnitModeStateCompatible(saved, key, unitId, saved.contentVersion)
                ? saved.resting
                : null,
          },
          controller.snapshot().units.some((unit) => unit.id === unitId),
          requested.origin,
        );
      }),
    );
  }, [bookId, controller, configurationWrites]);
  const retire = useCallback(() => {
    // The navigator/subscription may already be unmounting. Retain cancellation.
    if (controller.retire()) persistRequest();
  }, [controller, persistRequest]);
  useEffect(() => {
    if (!reading) return;
    const previous = previousEnvironment.current;
    const initial = previous?.controller !== controller;
    const origin = initial
      ? controller.requested().origin
      : previous.modes !== modes && eventCause(modes)
        ? actorFromEvent(modes)
        : causalActor("system");
    const selectionOrigin =
      !initial && previous.key === request.modeKey && previous.selected !== selected
        ? actorFromEvent(selected)
        : origin;
    previousEnvironment.current = { controller, modes, key: request.modeKey, selected };
    controller.environment(descriptors, supported, origin, selectionOrigin);
  }, [controller, descriptors, modes, reading, request.modeKey, selected, supported]);
  useEffect(() => {
    if (!reading) return;
    const publish = (origin?: DomainActor) =>
      setActiveReaderMode(controller, controller.requested().modeKey, origin ?? controller.requested().origin);
    publish();
    const off = controller.observe(publish);
    return () => {
      off();
      releaseActiveReaderMode(controller, actorFromEvent(readingRuntime.snapshot()));
    };
  }, [controller, reading]);

  useEffect(() => {
    if (!reading) return;
    return onLocalKVCommit((commit) => {
      const key = controller.requested().modeKey;
      if (!key || commit.entries.some((entry) => entry.key === textUnitModeStateKey(bookId))) return;
      // Configuration already commits the book and provider together. Only a
      // separate durable preference edit is a new intent; optimistic mirrors
      // and failed-write rollback must never manufacture one.
      const entry = commit.entries.find((entry) => entry.key === pluginSettingsKey(key.slice(0, key.indexOf(":"))));
      if (!entry) return;
      let unitId: string | null = null;
      try {
        const value: unknown = entry.value ? JSON.parse(entry.value) : null;
        if (value && typeof value === "object" && "unitId" in value && typeof value.unitId === "string")
          unitId = value.unitId;
      } catch {
        /* Invalid stored values provide no unit preference. */
      }
      const origin = eventCause(commit) ? actorFromEvent(commit, commit.actor ?? "system") : causalActor("system");
      void controller.reconcilePreference(() => unitId, origin);
    });
  }, [bookId, controller, reading]);
  useEffect(() => {
    if (!reading) return;
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
  }, [controller, persistRequest, reading]);

  useEffect(() => {
    if (!reading) return;
    let sessionId: string | null = null;
    let release: ((origin?: DomainActor) => void) | undefined;
    const unobserve = readingRuntime.observe((state) => {
      const id = state.bookId === bookId && state.status === "ready" ? state.sessionId : null;
      if (id === sessionId) return;
      sessionId = id;
      const origin = actorFromEvent(state);
      release?.(origin);
      release = undefined;
      if (id)
        release = readingRuntime.bindMode(
          id,
          {
            conditions: controller.conditions,
            snapshot: controller.snapshot,
            observe: controller.observe,
            generation: controller.generation,
            waitForPosition: (position, signal) => controller.waitForPosition(position, signal),
            step: (direction, signal, origin) => controller.step(direction, signal, origin),
            configure: (input, signal, origin) => controller.configure(input, signal, origin),
            retire,
          },
          origin,
        );
    });
    return () => {
      unobserve();
      release?.();
      retire();
      void afterLocalKVWrites(() => configurationWrites.release());
    };
  }, [bookId, controller, retire, configurationWrites, reading]);

  const setActive = useCallback((active: boolean) => controller.choose(active), [controller]);
  const setUnit = useCallback(
    (unitId: string) => controller.choose(controller.requested().active, unitId),
    [controller],
  );
  return { controller, request, snapshot, mode, setActive, setUnit };
}
