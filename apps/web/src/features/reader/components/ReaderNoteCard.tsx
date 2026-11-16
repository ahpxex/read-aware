import { useEffect } from "react";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { NoteCard, type Highlight, type NoteCardProps } from "../../annotations";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import type { SelectionOverlayRect } from "../lib/selection-overlay";
import { ReaderPassageMarks } from "./ReaderPassageMarks";
import { ReaderSheet } from "./ReaderSheet";

type ReaderNoteCardProps = Omit<NoteCardProps, "passage" | "className"> & {
  open: boolean;
  /** The passage's rect in reader-root coordinates; null centers the card. */
  anchorRect: SelectionOverlayRect | null;
  passage: string;
  /** Phone layout: the card rises as a sheet, which covers the page, so it quotes the passage. */
  phone: boolean;
  /** The passage's mark controls; null where the passage cannot be marked (no anchor). */
  marks: {
    mark: Highlight | null;
    defaultColor: Highlight["color"];
    onMark: (style: NonNullable<Highlight["style"]>, color: Highlight["color"]) => void;
    onRemove: () => void;
  } | null;
};

/**
 * Where the reader shows a passage's note card. On a wide screen it sits
 * beside the passage, below it when there is room, and leaves the page
 * undimmed so the text around it stays readable; a press anywhere outside it
 * saves and closes it (a tap on the page is handled by the reader, which owns
 * the book's frames). On a phone it is a sheet from the bottom edge.
 */
export function ReaderNoteCard({ open, anchorRect, passage, phone, marks, ...card }: ReaderNoteCardProps) {
  const { t } = useTranslation("ai");
  const { containerRef, menuRef, position } = useAnchoredMenuPosition(anchorRect, { prefer: "below" });
  const { onDone } = card;
  // The passage's mark sits above its notes: one card for everything on these words.
  const markRow = marks && <ReaderPassageMarks {...marks} className="mb-2 border-b border-border pb-2" />;

  // Pressing outside the card — the reader's own chrome, say — closes it, saving.
  useEffect(() => {
    if (!open || phone) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onDone();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menuRef, onDone, open, phone]);

  if (phone) {
    return (
      <ReaderSheet
        active={open ? "note" : null}
        onClose={onDone}
        render={() => ({
          title: t("note.cardLabel"),
          body: (
            <div className="overflow-y-auto px-4 pt-1 pb-4">
              {markRow}
              <NoteCard {...card} passage={passage} />
            </div>
          ),
        })}
      />
    );
  }

  if (!open) return null;
  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        ref={menuRef}
        className={cn(
          "ra-motion-overlay-pop pointer-events-auto absolute w-[22rem] max-w-[calc(100%-1.25rem)] rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-3 shadow-[0_8px_28px_-10px_rgba(28,25,23,0.35)]",
          // Without a passage rect (a keyboard shortcut in guided reading), the card centers.
          !anchorRect && "top-1/4 left-1/2 -translate-x-1/2",
        )}
        style={anchorRect ? position : undefined}
      >
        {markRow}
        <NoteCard {...card} />
      </div>
    </div>
  );
}
