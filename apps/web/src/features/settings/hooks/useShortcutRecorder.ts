import { useCallback, useEffect, useState } from "react";
import { chordFromEvent, type KeyChord, type ShortcutId } from "../lib/shortcuts";

type Recorder = {
  /** The shortcut currently capturing input, or `null`. */
  recordingId: ShortcutId | null;
  /** Begin capturing the next chord for a shortcut. */
  startRecording: (id: ShortcutId) => void;
  /** Stop capturing without changing anything. */
  cancel: () => void;
};

/**
 * Captures the next key chord for a shortcut being rebound. While recording, all
 * keydowns are swallowed (capture phase) so the keys under capture don't also
 * fire app shortcuts. Esc cancels; a lone modifier keeps waiting; any other
 * chord is reported via `onCapture` and ends the recording.
 */
export function useShortcutRecorder(
  onCapture: (id: ShortcutId, chord: KeyChord) => void,
): Recorder {
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);

  const cancel = useCallback(() => setRecordingId(null), []);

  useEffect(() => {
    if (!recordingId) return;

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingId(null);
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) return; // only modifiers held — keep waiting
      onCapture(recordingId!, chord);
      setRecordingId(null);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingId, onCapture]);

  return { recordingId, startRecording: setRecordingId, cancel };
}
