import { Fragment } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { Button, IconButton, InlineError, Kbd } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { shortcutBindingsAtom } from "../../../state/ui";
import { isAndroid } from "../../../platform/environment";
import { useLocale, useTranslation } from "../../../i18n";
import { contributionText, resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { resolveReaderModeUnit } from "../../plugins/lib/reader-mode";
import {
  pluginCommandsAtom,
  selectionActionsAtom,
  textUnitReaderModeAtom,
} from "../../plugins/state/plugin-store";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { useShortcutRecorder } from "../hooks/useShortcutRecorder";
import { useShortcutPreferences } from "../hooks/useShortcutPreferences";
import { shortcutRowsAtom } from "../state/shortcut-state";
import { shortcutConflicts } from "../lib/shortcut-catalog";
import {
  EDITABLE_SHORTCUTS,
  INFO_SHORTCUTS,
  type InfoShortcut,
  chordToTokens,
  pluginShortcutId,
  resolveBinding,
  resolvePluginBinding,
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
  const bindings = useAtomValue(shortcutBindingsAtom);
  const textUnitMode = useAtomValue(textUnitReaderModeAtom);
  const selectionActions = useAtomValue(selectionActionsAtom);
  const pluginCommands = useAtomValue(pluginCommandsAtom);
  const rows = useAtomValue(shortcutRowsAtom);
  const lookupAvailable = selectionActions.some((action) => action.role === "lookup");
  const { busy, rebind, reset, resetAll } = useShortcutPreferences();
  const { recordingId, startRecording, cancel } = useShortcutRecorder(rebind);
  const activePluginIds = new Set(pluginCommands.map(command => pluginShortcutId(command.key)));
  const dormant = Object.entries(bindings).filter(([id]) => id.startsWith("plugin:") && !activePluginIds.has(id as `plugin:${string}`));

  const hasOverrides = Object.keys(bindings).length > 0;
  const defaultModeUnit = textUnitMode
    ? resolveReaderModeUnit(textUnitMode, textUnitMode.defaultUnitId)
    : null;

  function shortcutLabel(
    id: ShortcutId | InfoShortcut["id"],
  ): string {
    if (id.startsWith("plugin:")) {
      const command = pluginCommands.find((entry) => pluginShortcutId(entry.key) === id);
      return command ? contributionText(command.title) : id;
    }
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

  function conflictNotice(id: ShortcutId) {
    const row = rows.find(row => row.id === id);
    const conflicts = row ? shortcutConflicts(row, rows) : [];
    return conflicts.length ? <InlineError compact>{t("shortcuts.conflictInactive", {
      label: conflicts.map(row => shortcutLabel(row.id)).join(", "),
    })}</InlineError> : undefined;
  }

  return (
    <SettingsPage
      title={t("shortcuts.title")}
      description={t("shortcuts.description")}
    >
      {CATEGORIES.map((category) => {
        const modeCategoryAvailable = category !== "TextUnitMode" || textUnitMode !== null;
        const editable = modeCategoryAvailable
          ? EDITABLE_SHORTCUTS.filter(
              (shortcut) =>
                shortcut.category === category &&
                (shortcut.id !== "selection-look-up" || lookupAvailable),
            )
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
              const label = shortcutLabel(shortcut.id);

              return (
                <SettingsRow
                  key={shortcut.id}
                  borderless={index === 0}
                  title={label}
                  description={conflictNotice(shortcut.id)}
                  control={
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={t("shortcuts.rebind", { label })}
                        disabled={busy}
                        onClick={() => {
                          if (recording) {
                            cancel();
                            return;
                          }
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
                          disabled={busy}
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

      {pluginCommands.length > 0 && (
        <SettingsGroup
          title={String(t("shortcuts.categories.Plugins" as never))}
          description={String(t("shortcuts.categoryDescriptions.plugins" as never))}
        >
          {pluginCommands.map((command, index) => {
            const id = pluginShortcutId(command.key);
            const binding = resolvePluginBinding(id, bindings, command.defaultShortcut);
            const overridden = bindings[id] !== undefined;
            const recording = recordingId === id;

            return (
              <SettingsRow
                key={command.key}
                borderless={index === 0}
                title={contributionText(command.title)}
                description={conflictNotice(id) ?? command.pluginName}
                control={
                  <span className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={t("shortcuts.rebind", { label: contributionText(command.title) })}
                      disabled={busy}
                      onClick={() => {
                        if (recording) {
                          cancel();
                          return;
                        }
                        startRecording(id);
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
                      ) : binding ? (
                        <KeyTokens tokens={chordToTokens(binding)} />
                      ) : (
                        <span className="font-sans text-[13px] text-fg-subtle">
                          {t("shortcuts.notSet")}
                        </span>
                      )}
                    </button>
                    {overridden && !recording && (
                      <IconButton
                        label={t("shortcuts.reset", { label: contributionText(command.title) })}
                        size="sm"
                        onClick={() => reset(id)}
                        disabled={busy}
                        icon={<ArrowCounterClockwise size={14} aria-hidden="true" />}
                      />
                    )}
                  </span>
                }
              />
            );
          })}
        </SettingsGroup>
      )}

      {dormant.length > 0 && (
        <SettingsGroup title={t("shortcuts.unavailable")}>
          {dormant.map(([id, binding], index) => (
            <SettingsRow key={id} borderless={index === 0} title={<span className="[overflow-wrap:anywhere]">{id.slice(7)}</span>} control={
              <span className="flex items-center gap-1.5">
                {binding && <KeyTokens tokens={chordToTokens(binding)} />}
                <IconButton label={t("shortcuts.reset", { label: id.slice(7) })} size="sm" disabled={busy}
                  onClick={() => reset(id as ShortcutId)} icon={<ArrowCounterClockwise size={14} aria-hidden="true" />} />
              </span>
            } />
          ))}
        </SettingsGroup>
      )}

      {hasOverrides && (
        <Button variant="link" disabled={busy} onClick={resetAll}>
          {t("shortcuts.resetAll")}
        </Button>
      )}
    </SettingsPage>
  );
}
