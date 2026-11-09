import { useRef, type CSSProperties, type ReactNode, type TransitionEvent } from "react";
import { cn } from "@read-aware/ui/cn";
import { useDrawerDragDismiss } from "../hooks/useDrawerDragDismiss";
import { usePanelSwipeDismiss } from "../hooks/usePanelSwipeDismiss";
import { useRetainedWhileClosing } from "../hooks/useRetainedWhileClosing";

export type ReaderSheetContent = {
  /** Names the sheet for assistive tech; the content says what it is. */
  title: string;
  /** Owns its own scrolling inside the sheet. */
  body: ReactNode;
  /** A tall sheet takes the screen below the status bar (the reader's bars
   *  step aside for it); a short one caps at about half the screen. */
  tall?: boolean;
};

/**
 * A phone reader sheet rising from the bottom edge — the contents, the notes,
 * the book search, and (with the toolbar at the top) appearance. One shows at
 * a time. It grows the way the bottom bar's drawer does (a grid-rows collapse
 * that keeps painting its content until the collapse ends), closes by pulling
 * it down, by swiping it away to the left, by a tap beside it or Escape.
 */
export function ReaderSheet<K extends string>({
  active,
  render,
  onClose,
}: {
  active: K | null;
  render: (key: K) => ReaderSheetContent;
  onClose: () => void;
}) {
  const { shown, settle } = useRetainedWhileClosing(active);
  const open = active !== null;
  const content = shown !== null ? render(shown) : null;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const growRef = useRef<HTMLDivElement | null>(null);
  useDrawerDragDismiss(growRef, { open, onDismiss: onClose });
  usePanelSwipeDismiss(sheetRef, { open, enabled: open, exit: "left", onDismiss: onClose });

  const onCollapseEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === "grid-template-rows") settle();
  };

  return (
    <>
      {/* A tap beside the sheet closes it rather than reaching the book. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "absolute inset-0 z-30 bg-stone-950/10 transition-opacity duration-250 motion-reduce:transition-none",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div ref={sheetRef} className="pointer-events-auto absolute inset-x-0 bottom-0 z-30">
        <div
          ref={growRef}
          role="dialog"
          aria-label={content?.title}
          aria-hidden={!open}
          inert={!open}
          onTransitionEnd={onCollapseEnd}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
          className={cn(
            "grid transition-[grid-template-rows] duration-250 ease-out motion-reduce:transition-none",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            {content && (
              <div
                style={
                  {
                    height: content.tall ? "calc(100dvh - var(--ra-safe-top) - 0.75rem)" : undefined,
                    paddingLeft: "var(--ra-safe-left)",
                    paddingRight: "var(--ra-safe-right)",
                    paddingBottom: "var(--ra-safe-bottom)",
                    backgroundColor: "var(--ra-main-surface-color)",
                    // What pinned headers inside the sheet paint over scrolling rows with.
                    "--ra-panel-surface": "var(--ra-main-surface-color)",
                  } as CSSProperties
                }
                className={cn(
                  "flex flex-col rounded-t-xl border-t border-border/70",
                  !content.tall && "max-h-[min(56dvh,30rem)]",
                )}
              >
                <span
                  aria-hidden="true"
                  className="mx-auto mt-2 block h-1 w-9 shrink-0 rounded-full bg-border-strong"
                />
                <div className="h-2 shrink-0" />
                {/* The sheet already clears the home indicator. */}
                <div style={{ "--ra-safe-bottom": "0px" } as CSSProperties} className="flex min-h-0 flex-1 flex-col">
                  {content.body}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
