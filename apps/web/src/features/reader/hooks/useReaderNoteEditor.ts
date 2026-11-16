import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "../../annotations/lib/annotation-types";
import { createNote } from "../../annotations/lib/annotation-db";
import { changeObservedAnnotation } from "../../annotations/lib/native-annotation-mutations";
import type { ActionTarget } from "../lib/reader-types";
import type { SelectionOverlayRect } from "../lib/selection-overlay";

/**
 * One draft at a time on the open passage: a new note (`base` null) or an edit
 * of one of its notes. An edit pins the note as observed when editing began —
 * observation updates never rebase it or discard the user's text, so a save
 * carries the original revision and a concurrent writer surfaces as a conflict.
 */
type Draft = { base: Note | null; text: string };
type Card = { owner: number; bookId: string; target: ActionTarget; anchorRect: SelectionOverlayRect | null };

const emptyDraft: Draft = { base: null, text: "" };

/** Whether committing `draft` would write anything. */
function pending(draft: Draft): boolean {
  const text = draft.text.trim();
  if (!draft.base) return text.length > 0;
  // An emptied note is not a deletion — only Delete deletes — so it keeps its text.
  return text.length > 0 && draft.text !== draft.base.content;
}

/**
 * The reader's note card for one passage: its notes, read in the caller's
 * live list, plus one draft. Closing saves ("close is save"): `done` commits
 * the draft and closes, so a dismissal — Escape, a tap on the page, turning
 * it, opening another passage — never loses what was written. A failed save
 * keeps the card open with the text, and reports.
 */
export function useReaderNoteEditor(
  bookId: string | undefined,
  clearSelection: () => void,
  report: (error: unknown, action: "save" | "delete") => void,
) {
  const [card, setCard] = useState<Card | null>(null);
  const [draft, setDraftState] = useState<Draft>(emptyDraft);
  const [isSaving, setIsSaving] = useState(false);
  const generation = useRef(0);
  const draftRef = useRef<Draft>(emptyDraft);
  const cardRef = useRef<Card | null>(null);
  /** The commit in flight for the current card, joined by any other caller. */
  const inFlight = useRef<{ owner: number; done: Promise<boolean> } | null>(null);

  const setDraft = useCallback((next: Draft) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const setOpenCard = useCallback((next: Card | null) => {
    cardRef.current = next;
    setCard(next);
  }, []);

  useEffect(() => {
    generation.current++;
    inFlight.current = null;
    setOpenCard(null);
    setDraft(emptyDraft);
    setIsSaving(false);
    return () => {
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation is a counter, not a node: cleanup bumps the live value
      generation.current++;
    };
  }, [bookId, setDraft, setOpenCard]);

  /** Write the draft, if it holds anything. Resolves whether the card may move on. */
  const commit = useCallback((): Promise<boolean> => {
    const current = cardRef.current;
    if (!current || current.bookId !== bookId || current.owner !== generation.current) return Promise.resolve(false);
    if (inFlight.current?.owner === current.owner) return inFlight.current.done;
    const snapshot = draftRef.current;
    if (!pending(snapshot)) return Promise.resolve(true);
    const owner = current.owner;
    setIsSaving(true);
    const done = (async () => {
      try {
        if (snapshot.base) await changeObservedAnnotation(snapshot.base, { op: "updateNote", body: snapshot.text });
        else
          await createNote(
            current.bookId,
            current.target.cfiRange,
            current.target.chapterHref,
            current.target.text,
            snapshot.text,
          );
        // Written: the next draft on this card starts as a new note.
        if (generation.current === owner && draftRef.current === snapshot) setDraft(emptyDraft);
        return true;
      } catch (error) {
        // Keep the same draft and revision; a retry must not overwrite a newer writer.
        report(error, "save");
        return false;
      } finally {
        if (generation.current === owner) {
          inFlight.current = null;
          setIsSaving(false);
        }
      }
    })();
    inFlight.current = { owner, done };
    return done;
  }, [bookId, report, setDraft]);

  const close = useCallback(() => {
    generation.current++;
    inFlight.current = null;
    setOpenCard(null);
    setDraft(emptyDraft);
    setIsSaving(false);
    clearSelection();
  }, [clearSelection, setDraft, setOpenCard]);

  /** Save the draft and close; on a failed save the card stays open with its text. */
  const done = useCallback(async (): Promise<void> => {
    const owner = cardRef.current?.owner;
    if (owner === undefined) return;
    const saved = await commit();
    if (saved && cardRef.current?.owner === owner) close();
  }, [close, commit]);

  /**
   * Open the card for a passage — at `anchorRect` — optionally editing one of
   * its notes. An open card is saved first; if that fails it stays open.
   */
  const open = useCallback(
    async (target: ActionTarget, anchorRect: SelectionOverlayRect | null, edit: Note | null = null) => {
      if (!bookId || (edit && edit.bookId !== bookId)) return;
      if (cardRef.current && !(await commit())) return;
      generation.current++;
      inFlight.current = null;
      setIsSaving(false);
      setOpenCard({ owner: generation.current, bookId, target: structuredClone(target), anchorRect });
      setDraft(edit ? { base: structuredClone(edit), text: edit.content } : emptyDraft);
    },
    [bookId, commit, setDraft, setOpenCard],
  );

  /** Edit one of the passage's notes (or, with null, go back to a new one); the current draft is saved first. */
  const edit = useCallback(
    async (note: Note | null) => {
      if (!cardRef.current || draftRef.current.base?.id === note?.id) return;
      if (!(await commit())) return;
      setDraft(note ? { base: structuredClone(note), text: note.content } : emptyDraft);
    },
    [commit, setDraft],
  );

  const setText = useCallback((text: string) => setDraft({ ...draftRef.current, text }), [setDraft]);

  /** Delete one of the passage's notes. Deleting the note being edited drops that edit. */
  const remove = useCallback(
    async (note: Note) => {
      const owner = cardRef.current?.owner;
      try {
        await changeObservedAnnotation(note, { op: "remove" });
        if (cardRef.current?.owner === owner && draftRef.current.base?.id === note.id) setDraft(emptyDraft);
      } catch (error) {
        report(error, "delete");
      }
    },
    [report, setDraft],
  );

  const current = card?.bookId === bookId ? card : null;
  return {
    open,
    done,
    close,
    edit,
    remove,
    setText,
    /** Commit the draft without closing (used before the card moves on). */
    commit,
    draftKey: current?.owner ?? 0,
    isOpen: !!current,
    isSaving: !!current && isSaving,
    target: current?.target ?? null,
    anchorRect: current?.anchorRect ?? null,
    /** The note being edited, as it was when editing began; null for a new note. */
    editing: current ? draft.base : null,
    text: current ? draft.text : "",
  };
}
