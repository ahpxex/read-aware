import { Fragment, useCallback, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useAtom } from "jotai";
import { IconButton, Kbd } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { shortcutBindingsAtom } from "../../../state/ui";
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
  type ShortcutId,
} from "../lib/shortcuts";

const CATEGORIES = ["Global", "Reading", "Overlays"] as const;

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
  const [bindings, setBindings] = useAtom(shortcutBindingsAtom);
  const [conflict, setConflict] = useState<{ id: ShortcutId; label: string } | null>(null);

  const onCapture = useCallback(
    (id: ShortcutId, chord: KeyChord) => {
      const signature = chordSignature(chord);
      const clash = EDITABLE_SHORTCUTS.find(
        (shortcut) =>
          shortcut.id !== id && chordSignature(resolveBinding(shortcut.id, bindings)) === signature,
      );
      if (clash) {
        setConflict({ id, label: clash.label });
        return;
      }
      setConflict(null);
      setBindings({ ...bindings, [id]: chord });
    },
    [bindings, setBindings],
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

  return (
    <SettingsPage
      title="Shortcuts"
      description="Click a shortcut to rebind it; press Esc while recording to cancel."
    >
      {CATEGORIES.map((category) => {
        const editable = EDITABLE_SHORTCUTS.filter((shortcut) => shortcut.category === category);
        const info = INFO_SHORTCUTS.filter((shortcut) => shortcut.category === category);
        if (!editable.length && !info.length) return null;

        return (
          <SettingsGroup key={category} title={category}>
            {editable.map((shortcut, index) => {
              const binding = resolveBinding(shortcut.id, bindings);
              const overridden = bindings[shortcut.id] !== undefined;
              const recording = recordingId === shortcut.id;
              const showConflict = conflict?.id === shortcut.id;

              return (
                <SettingsRow
                  key={shortcut.id}
                  borderless={index === 0}
                  title={shortcut.label}
                  description={
                    showConflict && !recording ? (
                      <span className="text-red-600 dark:text-red-400">
                        Already used by “{conflict?.label}”
                      </span>
                    ) : undefined
                  }
                  control={
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Rebind ${shortcut.label}`}
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
                              Press a shortcut…
                            </span>
                          </span>
                        ) : (
                          <KeyTokens tokens={chordToTokens(binding)} />
                        )}
                      </button>
                      {overridden && !recording && (
                        <IconButton
                          label={`Reset ${shortcut.label}`}
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
                title={shortcut.label}
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
          Reset all to defaults
        </button>
      )}
    </SettingsPage>
  );
}
