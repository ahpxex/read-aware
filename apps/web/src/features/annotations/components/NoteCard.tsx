import { useEffect, useRef, type KeyboardEvent } from "react";
import { PencilSimple, Trash } from "@phosphor-icons/react";
import { Button, IconButton, Kbd, TextArea } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatDate, useTranslation } from "../../../i18n";
import type { Note } from "../lib/annotation-types";

export type NoteCardProps = {
  /** The passage's notes, oldest first — a dated thread the draft adds to. */
  notes: Note[];
  /** The note being edited in place; null when the draft is a new note. */
  editingId: string | null;
  text: string;
  onTextChange: (text: string) => void;
  /** Edit one of the notes (null: back to writing a new one). */
  onEdit: (note: Note | null) => void;
  onDelete: (note: Note) => void;
  /** Save and close. Escape and the shortcut do the same: closing is saving. */
  onDone: () => void;
  isSaving?: boolean;
  /** The passage itself, for a surface that covers it (the phone sheet). */
  passage?: string;
  /** Keys of the save-and-close shortcut, e.g. `["⌘", "Enter"]`. */
  doneShortcut: string[];
  className?: string;
};

/** A month-day stamp with the time; the year only when it is not this one. */
function stamp(iso: string, now: number): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return formatDate(date, {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Edited later than written — a minute's grace covers the first save's own round trip. */
const wasEdited = (note: Note) => Date.parse(note.updatedAt) - Date.parse(note.createdAt) > 60_000;

/**
 * Notes on one passage, as a card beside it: the notes already written, each
 * dated, and a field to add another — or one of them opened for editing in
 * its place. No title, no Save: closing the card (Done, the shortcut, Escape,
 * or anything that dismisses it) saves what was written. An emptied note is
 * not deleted; Delete does that.
 *
 * Purely presentational: the reader owns the draft, the saves, and where the
 * card sits.
 */
export function NoteCard({
  notes,
  editingId,
  text,
  onTextChange,
  onEdit,
  onDelete,
  onDone,
  isSaving = false,
  passage,
  doneShortcut,
  className,
}: NoteCardProps) {
  const { t } = useTranslation("ai");
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const now = Date.now();

  // The field takes focus whenever the draft moves (opening, editing another
  // note), with the caret after the text so writing continues it.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editingId]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Never act on a key that is still composing (an IME candidate).
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      // The card handles its own Escape: the reader beneath must not also act on it.
      event.stopPropagation();
      onDone();
    }
  };

  const field = (
    <TextArea
      ref={fieldRef}
      label={t("note.bodyLabel")}
      hideLabel
      variant="plain"
      size="sm"
      rows={3}
      value={text}
      onChange={(event) => onTextChange(event.target.value)}
      placeholder={notes.length > 0 ? t("note.placeholderMore") : t("note.placeholder")}
    />
  );

  return (
    <div
      role="group"
      aria-label={t("note.cardLabel")}
      onKeyDown={onKeyDown}
      className={cn("flex flex-col font-sans", className)}
    >
      {passage && (
        <p className="mb-3 line-clamp-2 border-l-2 border-border-strong pl-2.5 text-[13px] leading-relaxed text-fg-muted">
          &ldquo;{passage}&rdquo;
        </p>
      )}
      {notes.length > 0 && (
        <ul className="-mx-1 mb-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
          {notes.map((note) =>
            note.id === editingId ? (
              <li key={note.id} className="px-1 py-1">
                <p className="mb-1 text-[11px] text-fg-subtle">{stamp(note.createdAt, now)}</p>
                {field}
              </li>
            ) : (
              <li key={note.id} className="group rounded-control px-1 py-1 hover:bg-fg/5">
                <div className="flex h-6 items-center justify-between gap-2">
                  <p className="text-[11px] text-fg-subtle">
                    {stamp(note.createdAt, now)}
                    {wasEdited(note) && ` · ${t("note.edited")}`}
                  </p>
                  {/* On the date line's right end, shown on hover or focus for a
                      mouse and always for touch: the note keeps its full width. */}
                  <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                    <IconButton
                      size="sm"
                      label={t("note.editNote")}
                      onClick={() => onEdit(note)}
                      className="text-fg-subtle hover:text-fg"
                      icon={<PencilSimple size={13} />}
                    />
                    <IconButton
                      size="sm"
                      label={t("note.deleteNote")}
                      onClick={() => onDelete(note)}
                      className="text-fg-subtle hover:text-red-600"
                      icon={<Trash size={13} />}
                    />
                  </div>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{note.content}</p>
              </li>
            ),
          )}
        </ul>
      )}
      {editingId === null ? (
        // Under a thread, a hairline sets the new note apart from the written ones.
        <div className={cn(notes.length > 0 && "border-t border-border pt-2")}>{field}</div>
      ) : (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => onEdit(null)}>
          {t("note.addAnother")}
        </Button>
      )}
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
          {doneShortcut.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
          <span className="ml-0.5">{t("note.doneHint")}</span>
        </span>
        {/* Quiet: closing the card any way saves, so Done is one way among several, not a commit. */}
        <Button variant="ghost" size="sm" onClick={onDone} disabled={isSaving} aria-busy={isSaving}>
          {t("note.done")}
        </Button>
      </div>
    </div>
  );
}
