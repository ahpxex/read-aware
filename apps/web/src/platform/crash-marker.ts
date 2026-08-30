/**
 * Cross-launch crash marker. When the app dies in a way the user saw — the
 * boot-failure screen or the root error boundary — the failing code path
 * writes a marker; the NEXT healthy launch consumes it and offers to send a
 * diagnostics report (see CrashFollowUpPrompt). Ask-first by design: nothing
 * is sent without the user walking through the existing preview-and-confirm
 * diagnostics flow.
 *
 * Deliberately plain `localStorage`, not `localKV`: the marker must survive
 * being written from contexts where the storage layer itself may be what
 * failed (boot), and it is device-local state that must never roam.
 */
const KEY = "read-aware-crash-pending";

export type CrashKind = "boot" | "render";

export function markCrash(kind: CrashKind): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ kind, at: Date.now() }));
  } catch {
    // Storage unavailable (private mode, corrupted profile) — the prompt is
    // best-effort; losing it must never add a second failure.
  }
}

/** Read AND clear the marker — the prompt is offered once per crash. */
export function consumeCrashMarker(): { kind: CrashKind; at: number } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as { kind?: unknown; at?: unknown };
    if ((parsed.kind === "boot" || parsed.kind === "render") && typeof parsed.at === "number") {
      return { kind: parsed.kind, at: parsed.at };
    }
    return null;
  } catch {
    return null;
  }
}
