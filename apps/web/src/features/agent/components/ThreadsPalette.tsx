/**
 * The Agent page's thread palette — the container half. Opened from the
 * header's Threads button (`threadsPaletteOpenAtom`); `useAgentThreads` is
 * mounted, and so subscribed to conversation changes, only while it is open.
 * Choosing a thread opens it and closes the palette; deleting keeps it open.
 */
import { useEffect } from "react";
import { useAtom } from "jotai";
import { useAgentThreads } from "../hooks/useAgentThreads";
import { threadsPaletteOpenAtom } from "../state/threads-palette";
import { ThreadsPaletteView } from "./ThreadsPaletteView";

export function ThreadsPalette() {
  const [open, setOpen] = useAtom(threadsPaletteOpenAtom);
  // Leaving the page closes it, so it does not greet the next visit.
  useEffect(() => () => setOpen(false), [setOpen]);
  return open ? <OpenThreadsPalette onClose={() => setOpen(false)} /> : null;
}

function OpenThreadsPalette({ onClose }: { onClose: () => void }) {
  const threads = useAgentThreads();
  return (
    <ThreadsPaletteView
      open
      onClose={onClose}
      threads={threads.threads}
      isLoading={threads.isLoading}
      loadFailure={threads.loadFailure}
      onRetry={threads.retry}
      activeThreadId={threads.activeThreadId}
      onSelect={(threadId) => {
        threads.select(threadId);
        onClose();
      }}
      onDelete={threads.remove}
    />
  );
}
