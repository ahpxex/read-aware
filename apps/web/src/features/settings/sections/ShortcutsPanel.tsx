import { Fragment, useCallback, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useAtom, useAtomValue } from "jotai";
import { IconButton, Kbd } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { shortcutBindingsAtom } from "../../../state/ui";
import { isAndroid } from "../../../platform/environment";
import { useLocale, useTranslation } from "../../../i18n";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { resolveReaderModeUnit } from "../../plugins/lib/reader-mode";
import { textUnitReaderModeAtom } from "../../plugins/state/plugin-store";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { useShortcutRecorder } from "../hooks/useShortcutRecorder";
import {
  EDITABLE_SHORTCUTS,
  INFO_SHORTCUTS,
  chordSignature,
  chordToTokens,
  resolveBinding,
  type KeyChord,
  type ShortcutCategory,
  type ShortcutId,
} from "../lib/shortcuts";

const CATEGORIES: ShortcutCategory[] = [
  "Global",
  "Reading",
  "TextUnitMode",
  "Selection",
  "Overlays",
];

/** Catalog keys for per-category helper text, shown under the group title where
 *  it helps. Categories without an entry render no description. */
const CATEGORY_DESCRIPTION_KEYS: Partial<Record<ShortcutCategory, string>> = {
  Selection: "shortcuts.categoryDescriptions.selection",
};

function KeyTokens({ tokens }: { tokens: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {tokens.map((token, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="px-0.5 text-[11px] text-fg-subtle">+</span>}
          <Kbd>{token}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutsPanel() {
  const { t } = useTranslation("settings");
  const locale = useLocale();
  const [bindings, setBindings] = useAtom(shortcutBindingsAtom);
  const textUnitMode = useAtomValue(textUnitReaderModeAtom);
  const [conflict, setConflict] = useState<{ id: ShortcutId; conflictId: ShortcutId } | null>(null);

  const onCapture = useCallback(
    (id: ShortcutId, chord: KeyChord) => {
      const signature = chordSignature(chord);
      const clash = EDITABLE_SHORTCUTS.find(
        (shortcut) =>
          (shortcut.category !== "TextUnitMode" || textUnitMode !== null) &&
          shortcut.id !== id && chordSignature(resolveBinding(shortcut.id, bindings)) === signature,
      );
      if (clash) {
        setConflict({ id, conflictId: clash.id });
        return;
      }
      setConflict(null);
      setBindings({ ...bindings, [id]: chord });
    },
    [bindings, textUnitMode, setBindings],
  );

  const { recordingId, startRecording, cancel } = useShortcutRecorder(onCapture);

  const reset = useCallback(
    (id: ShortcutId) => {
      const next = { ...bindings };
      delete next[id];
      setBindings(next);
      setConflict((current) => (current?.id === id ? null : current));
    },
    [bindings, setBindings],
  );

  const resetAll = useCallback(() => {
    setBindings({});
    setConflict(null);
  }, [setBindings]);

  const hasOverrides = Object.keys(bindings).length > 0;
  const defaultModeUnit = textUnitMode
    ? resolveReaderModeUnit(textUnitMode, textUnitMode.defaultUnitId)
    : null;

  function shortcutLabel(id: ShortcutId | "close" | "reader-mode-volume-keys"): string {
    if (textUnitMode && defaultModeUnit) {
      if (id === "reader-mode-next-unit") {
        return resolvePluginText(defaultModeUnit.nextLabel, locale);
      }
      if (id === "reader-mode-prev-unit") {
        return resolvePluginText(defaultModeUnit.previousLabel, locale);
      }
      if (id === "reader-mode-volume-keys") {
        return resolvePluginText(textUnitMode.copy.shortcuts.volumeKeys, locale);
      }
    }
    return String(t(`shortcuts.actions.${id}` as never));
  }

  return (
    <SettingsPage
      title={t("shortcuts.title")}
      description={t("shortcuts.description")}
    >
      {CATEGORIES.map((category) => {
        const modeCategoryAvailable = category !== "TextUnitMode" || textUnitMode !== null;
        const editable = modeCategoryAvailable
          ? EDITABLE_SHORTCUTS.filter((shortcut) => shortcut.category === category)
          : [];
        const info = INFO_SHORTCUTS.filter(
          (shortcut) =>
            modeCategoryAvailable &&
            shortcut.category === category &&
            (!shortcut.androidOnly || isAndroid()),
        );
        if (!editable.length && !info.length) return null;

        const descriptionKey = CATEGORY_DESCRIPTION_KEYS[category];
        const categoryTitle =
          category === "TextUnitMode" && textUnitMode
            ? resolvePluginText(textUnitMode.copy.title, locale)
            : String(t(`shortcuts.categories.${category}` as never));
        const categoryDescription =
          category === "TextUnitMode" && textUnitMode
            ? resolvePluginText(textUnitMode.copy.shortcuts.description, locale)
            : descriptionKey
              ? String(t(descriptionKey as never))
              : undefined;

        return (
          <SettingsGroup
            key={category}
            title={categoryTitle}
            description={categoryDescription}
          >
            {editable.map((shortcut, index) => {
              const binding = resolveBinding(shortcut.id, bindings);
              const overridden = bindings[shortcut.id] !== undefined;
              const recording = recordingId === shortcut.id;
              const showConflict = conflict?.id === shortcut.id;
              const label = shortcutLabel(shortcut.id);

              return (
                <SettingsRow
                  key={shortcut.id}
                  borderless={index === 0}
                  title={label}
                  description={
                    showConflict && conflict && !recording ? (
                      <span className="text-red-600 dark:text-red-400">
                        {t("shortcuts.conflict", {
                          label: shortcutLabel(conflict.conflictId),
                        })}
                      </span>
                    ) : undefined
                  }
                  control={
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={t("shortcuts.rebind", { label })}
                        onClick={() => {
                          if (recording) {
                            cancel();
                            return;
                          }
                          setConflict(null);
                          startRecording(shortcut.id);
                        }}
                        className={cn(
                          "rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                          recording ? "bg-fill" : "hover:bg-fill",
                        )}
                      >
                        {recording ? (
                          <span className="flex items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-fg-subtle"
                            />
                            <span className="font-sans text-[13px] text-fg-muted">
                              {t("shortcuts.recording")}
                            </span>
                          </span>
                        ) : (
                          <KeyTokens tokens={chordToTokens(binding)} />
                        )}
                      </button>
                      {overridden && !recording && (
                        <IconButton
                          label={t("shortcuts.reset", { label })}
                          size="sm"
                          onClick={() => reset(shortcut.id)}
                          icon={<ArrowCounterClockwise size={14} aria-hidden="true" />}
                        />
                      )}
                    </span>
                  }
                />
              );
            })}

            {info.map((shortcut, index) => (
              <SettingsRow
                key={shortcut.id}
                borderless={index === 0 && editable.length === 0}
                title={shortcutLabel(shortcut.id)}
                control={<KeyTokens tokens={shortcut.keys} />}
              />
            ))}
          </SettingsGroup>
        );
      })}

      {hasOverrides && (
        <button
          type="button"
          onClick={resetAll}
          className="font-sans text-[13px] text-fg-muted underline-offset-2 transition-colors hover:text-fg hover:underline"
        >
          {t("shortcuts.resetAll")}
        </button>
      )}
    </SettingsPage>
  );
}
