import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "../../annotations/lib/annotation-types";
import { createNote } from "../../annotations/lib/annotation-db";
import { changeObservedAnnotation } from "../../annotations/lib/native-annotation-mutations";
import type { ActionTarget } from "../lib/reader-types";

type Draft = { owner: number; bookId: string; target: ActionTarget; note: Note | null };

/** A draft owns the original observed token until explicitly closed/reopened.
 * Observation updates never rebase it or discard the user's text. */
export function useReaderNoteEditor(bookId: string | undefined, clearSelection: () => void, report: (error: unknown) => void) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const generation = useRef(0);
  const saving = useRef<number | null>(null);
  useEffect(() => {
    generation.current++;
    saving.current = null;
    setDraft(null); setIsSaving(false);
    return () => { generation.current++; };
  }, [bookId]);

  const open = useCallback((target: ActionTarget, note: Note | null = null) => {
    if (!bookId || note && note.bookId !== bookId) return;
    generation.current++;
    saving.current = null;
    setDraft({ owner: generation.current, bookId, target: structuredClone(target), note: note ? structuredClone(note) : null });
    setIsSaving(false);
  }, [bookId]);

  const close = useCallback(() => {
    generation.current++;
    saving.current = null;
    setDraft(null); setIsSaving(false); clearSelection();
  }, [clearSelection]);

  const save = useCallback(async (content: string) => {
    if (!draft || draft.bookId !== bookId || draft.owner !== generation.current || saving.current !== null) return;
    const owner = draft.owner;
    saving.current = owner; setIsSaving(true);
    try {
      if (draft.note) await changeObservedAnnotation(draft.note, { op: "updateNote", body: content });
      else await createNote(draft.bookId, draft.target.cfiRange, draft.target.chapterHref, draft.target.text, content);
      if (generation.current === owner) close();
    } catch (error) {
      // Keep the same draft/revision on conflict; retry must not overwrite a newer writer.
      report(error);
    } finally {
      if (generation.current === owner) { saving.current = null; setIsSaving(false); }
    }
  }, [bookId, close, draft, report]);

  const current = draft?.bookId === bookId ? draft : null;
  return { open, draftKey: current?.owner ?? 0, isOpen: !!current, isSaving: !!current && isSaving,
    target: current?.target ?? null, current: current?.note ?? null, save, close };
}
