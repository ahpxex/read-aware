import { useRef, type CSSProperties, type ReactNode, type Ref, type TransitionEvent } from "react";
import { cn } from "@read-aware/ui/cn";
import { useDrawerDragDismiss } from "../hooks/useDrawerDragDismiss";
import { useRetainedWhileClosing } from "../hooks/useRetainedWhileClosing";

export type ReaderBottomBarDrawer = {
  /** Names the drawer for assistive tech. Not shown: the icon that opened it
   *  stays highlighted below, and the panel's content says what it is. */
  title: string;
  /** Owns its own padding and scrolling inside the drawer's height cap. */
  body: ReactNode;
};

type ReaderBottomBarProps<K extends string> = {
  /** Revealed with the rest of the reader chrome. */
  visible: boolean;
  /** Measured by useToolbarSlotCapacity; spans the bar's full width. */
  slotRowRef: Ref<HTMLDivElement>;
  /** One node per slot, in order; each fills an equal column. */
  slots: ReactNode[];
  /** The drawer's element id, for the triggers' aria-controls. */
  drawerId: string;
  /** Which drawer is open, if any. */
  drawer: K | null;
  renderDrawer: (key: K) => ReaderBottomBarDrawer;
  onCloseDrawer: () => void;
};

/**
 * The phone reader's actions, docked at the bottom where a thumb reaches them:
 * icons in equal slots (IconButton size "toolbar"), arranged by the user. It
 * slides away with the chrome and pads itself above the home indicator.
 * Reading progress lives in the top bar, along its bottom edge.
 *
 * Panels that belong to the bar (appearance, notes) open as a drawer: the bar
 * itself grows upward to hold them, above the icon row that stays in place,
 * rather than floating a separate card over the page. It grows with the same
 * grid-rows collapse the shared Accordion uses, and keeps painting the panel
 * it held until the collapse ends. Pulling it down closes it (see
 * useDrawerDragDismiss); the grabber at its top says so.
 */
export function ReaderBottomBar<K extends string>({
  visible,
  slotRowRef,
  slots,
  drawerId,
  drawer,
  renderDrawer,
  onCloseDrawer,
}: ReaderBottomBarProps<K>) {
  const { shown, settle } = useRetainedWhileClosing(drawer);
  const open = drawer !== null;
  const content = shown !== null ? renderDrawer(shown) : null;
  const drawerRef = useRef<HTMLDivElement | null>(null);
  useDrawerDragDismiss(drawerRef, { open, onDismiss: onCloseDrawer });

  const onCollapseEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === "grid-template-rows") settle();
  };

  return (
    <div
      inert={!visible}
      style={{ paddingBottom: "var(--ra-safe-bottom)" }}
      className={cn(
        // z-20 like the top bar: popovers opening upward from a slot paint
        // over the sheets in the middle zone (z-10).
        "pointer-events-auto relative z-20 shrink-0 border-t border-border/70 bg-fill transition-all duration-250 ease-out",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0",
      )}
    >
      <div
        ref={drawerRef}
        id={drawerId}
        role="region"
        aria-label={content?.title}
        aria-hidden={!open}
        inert={!open}
        onTransitionEnd={onCollapseEnd}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCloseDrawer();
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
                  paddingLeft: "var(--ra-safe-left)",
                  paddingRight: "var(--ra-safe-right)",
                  // What pinned headers inside a panel paint over scrolling rows with.
                  "--ra-panel-surface": "var(--color-fill)",
                } as CSSProperties
              }
              className="flex max-h-[min(56dvh,30rem)] flex-col border-b border-border/70"
            >
              <span aria-hidden="true" className="mx-auto mt-2 block h-1 w-9 shrink-0 rounded-full bg-border-strong" />
              <div className="h-3 shrink-0" />
              {content.body}
            </div>
          )}
        </div>
      </div>
      <div
        ref={slotRowRef}
        className="grid py-1"
        style={{
          paddingLeft: "max(0.5rem, var(--ra-safe-left))",
          paddingRight: "max(0.5rem, var(--ra-safe-right))",
          gridTemplateColumns: `repeat(${Math.max(1, slots.length)}, minmax(0, 1fr))`,
        }}
      >
        {slots}
      </div>
    </div>
  );
}
