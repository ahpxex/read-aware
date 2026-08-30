/**
 * Everything the reader can DO to a passage: mark it, note it, look it up, ask
 * about it — and the note editor those actions open.
 *
 * Extracted from FoliateReaderView. Three surfaces invoke the same set of verbs
 * against different targets (a live selection, the annotation under the cursor,
 * the guided-reading unit), which is why they belong together: the target
 * differs, the action does not.
 *
 * The note editor's state, the default mark colour, and the annotations
 * revision signal live here too — they were only ever touched by these actions,
 * so keeping them outside would have meant passing five more handles in.
 */
import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { annotationsRevisionAtom } from "../../annotations/state/annotations-revision";
import { askAiRequestAtom } from "../../ai/state/chat-intent";
import { selectionActionsAtom } from "../../plugins/state/plugin-store";
import { runPluginContribution } from "../../plugins/lib/run-result";
import type { SelectionActionInput, SelectionActionSource } from "../../plugins/lib/plugin-types";
import {
  createHighlight,
  createNote,
  deleteAnnotation,
  recolorHighlight,
  updateNote,
} from "../../annotations/lib/annotation-db";
import {
  getDefaultMarkColor,
  setDefaultMarkColor,
} from "../../annotations/lib/annotation-prefs";
import type { Highlight, Note } from "../../annotations/lib/annotation-types";
import { applyHighlight, applyNote, removeHighlight } from "../lib/highlight-renderer";
import type { FoliateView } from "../lib/foliate-engine";
import type { LibraryBook } from "../../library/lib/library-types";
import type { SelectionOverlayRect } from "../lib/selection-overlay";
import { useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reader");

/** A passage an action applies to, wherever it came from. */
export type ActionTarget = {
  text: string;
  cfiRange: string | null;
  chapterHref: string | null;
};

/** The annotation the reader tapped, with the rect its menu anchors to. */
export type ActiveAnnotation = {
  highlight: Highlight;
  anchorRect: SelectionOverlayRect;
} | null;

/** The live text selection, as the reader view tracks it. */
type LiveSelection = {
  text: string;
  cfiRange: string | null;
  chapterHref: string | null;
  context?: string;
} | null;

type Options = {
  selectedBook: LibraryBook | null;
  selection: LiveSelection;
  activeAnnotation: ActiveAnnotation;
  /** Owned by the view: a relocate clears it, so it cannot live in here. */
  setActiveAnnotation: (value: ActiveAnnotation) => void;
  /** The guided-reading unit currently washed, if that mode is on. */
  textUnitNavigator: { current: { text: string; cfiRange: string | null } | null };
  clearSelection: () => void;
  viewRef: RefObject<FoliateView | null>;
  highlightsRef: RefObject<Highlight[]>;
  notesRef: RefObject<Note[]>;
  currentChapterHrefRef: RefObject<string | null>;
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard unavailable");
}

export function useReaderTextActions({
  selectedBook,
  selection,
  activeAnnotation,
  setActiveAnnotation,
  textUnitNavigator,
  clearSelection,
  viewRef,
  highlightsRef,
  notesRef,
  currentChapterHrefRef,
}: Options) {
  const { toast } = useToast();
  const { t: tErrors } = useTranslation(["reader", "common"]);
  // Ref so the failure toasts stay out of every callback's dep list.
  type AnnotationFailureKey =
    | "annotations.saveFailed"
    | "annotations.noteSaveFailed"
    | "annotations.updateFailed"
    | "annotations.deleteFailed";
  const failToastRef = useRef<(titleKey: AnnotationFailureKey, error: unknown) => void>(() => {});
  failToastRef.current = (titleKey, error) => {
    toast({
      variant: "destructive",
      title: tErrors(`reader:${titleKey}`),
      description: describeError(error).body,
    });
  };

  const bumpAnnotationsRevision = useSetAtom(annotationsRevisionAtom);
  const dispatchAskAi = useSetAtom(askAiRequestAtom);
  const pluginSelectionActions = useAtomValue(selectionActionsAtom);
  const lookupAction =
    pluginSelectionActions.find((action) => action.role === "lookup") ?? null;

  /** Last colour the reader chose, applied to new marks. */
  const defaultMarkColorRef = useRef<Highlight["color"]>(getDefaultMarkColor());

  const [noteTarget, setNoteTarget] = useState<ActionTarget | null>(null);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);

  const copyTargetText = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await copyText(text);
    } catch {
      // Clipboard access can be unavailable outside a trusted user gesture.
    }
  }, []);

  const openNoteEditorFor = useCallback((target: ActionTarget) => {
    setNoteTarget(target);
    setCurrentNote(null);
    setNoteEditorOpen(true);
  }, []);

  /** Open the note editor for a passage — editing the note already on it, if any. */
  const openNoteEditorForPassage = useCallback(
    (target: ActionTarget) => {
      const existing = target.cfiRange
        ? notesRef.current?.find((note) => note.cfiRange === target.cfiRange)
        : undefined;
      if (existing) {
        setNoteTarget({
          text: existing.text,
          cfiRange: existing.cfiRange,
          chapterHref: existing.chapterHref,
        });
        setCurrentNote(existing);
        setNoteEditorOpen(true);
      } else {
        openNoteEditorFor(target);
      }
    },
    [notesRef, openNoteEditorFor],
  );

  /**
   * Open a note the reader tapped in the text. Distinct from
   * `openNoteEditorForPassage`, which has to go looking for one by anchor —
   * here the note is already in hand.
   */
  const openExistingNote = useCallback((note: Note) => {
    setNoteTarget({
      text: note.text,
      cfiRange: note.cfiRange,
      chapterHref: note.chapterHref,
    });
    setCurrentNote(note);
    setNoteEditorOpen(true);
  }, []);

  const pluginInputFor = useCallback(
    (
      target: ActionTarget | null,
      source: SelectionActionSource,
      context?: string,
    ): SelectionActionInput | null => {
      if (!selectedBook || !target) return null;
      return {
        text: target.text,
        context,
        cfiRange: target.cfiRange,
        chapterHref: target.chapterHref,
        book: { id: selectedBook.id, title: selectedBook.title, author: selectedBook.author },
        source,
      };
    },
    [selectedBook],
  );

  const runLookupAction = useCallback(
    (input: SelectionActionInput | null) => {
      if (!lookupAction || !input) return;
      void runPluginContribution(
        lookupAction.pluginId,
        lookupAction.pluginName,
        () => lookupAction.run(input),
        { presentation: lookupAction.presentation },
      );
    },
    [lookupAction],
  );

  const requestAskAi = useCallback(
    (target: ActionTarget) => {
      if (!selectedBook) return;
      dispatchAskAi({
        id: crypto.randomUUID(),
        bookId: selectedBook.id,
        attachment: {
          kind: "selection",
          text: target.text,
          cfiRange: target.cfiRange,
          chapterHref: target.chapterHref,
        },
      });
    },
    [dispatchAskAi, selectedBook],
  );

  /** Persist and draw a mark over a passage. Returns whether it saved. */
  const saveMark = useCallback(
    async (
      target: ActionTarget,
      color: Highlight["color"],
      style: NonNullable<Highlight["style"]>,
    ): Promise<boolean> => {
      if (!selectedBook) return false;
      try {
        const highlight = await createHighlight(
          selectedBook.id,
          target.cfiRange,
          target.chapterHref,
          target.text,
          color,
          style,
        );
        if (highlightsRef.current) {
          highlightsRef.current = [...highlightsRef.current, highlight];
        }
        if (viewRef.current) applyHighlight(viewRef.current, highlight);
        bumpAnnotationsRevision((c) => c + 1);
        return true;
      } catch (highlightError) {
        log.error("failed to save highlight", highlightError);
        failToastRef.current("annotations.saveFailed", highlightError);
        return false;
      }
    },
    [bumpAnnotationsRevision, highlightsRef, selectedBook, viewRef],
  );

  // ── Against the live selection ─────────────────────────────────────────────

  const handleHighlight = useCallback(
    async (
      color: Highlight["color"] = defaultMarkColorRef.current,
      style: NonNullable<Highlight["style"]> = "highlight",
    ) => {
      if (!selection) return;
      const saved = await saveMark(
        { text: selection.text, cfiRange: selection.cfiRange, chapterHref: selection.chapterHref },
        color,
        style,
      );
      if (saved) clearSelection();
    },
    [clearSelection, saveMark, selection],
  );

  const handleUnderline = useCallback(() => {
    void handleHighlight(defaultMarkColorRef.current, "underline");
  }, [handleHighlight]);

  const handleLookUp = useCallback(() => {
    if (!selection) return;
    runLookupAction(
      pluginInputFor(
        { text: selection.text, cfiRange: selection.cfiRange, chapterHref: selection.chapterHref },
        "selection",
        selection.context,
      ),
    );
    clearSelection();
  }, [clearSelection, pluginInputFor, runLookupAction, selection]);

  const handleAddNote = useCallback(() => {
    if (!selection) return;
    openNoteEditorFor({
      text: selection.text,
      cfiRange: selection.cfiRange,
      chapterHref: selection.chapterHref,
    });
  }, [openNoteEditorFor, selection]);

  const handleAskAI = useCallback(() => {
    if (!selection) return;
    requestAskAi({
      text: selection.text,
      cfiRange: selection.cfiRange,
      chapterHref: selection.chapterHref,
    });
    clearSelection();
  }, [clearSelection, requestAskAi, selection]);

  // ── Against the annotation the reader tapped ───────────────────────────────

  const activeAnnotationTarget = useCallback((): ActionTarget | null => {
    const highlight = activeAnnotation?.highlight;
    if (!highlight) return null;
    return {
      text: highlight.text,
      cfiRange: highlight.cfiRange,
      chapterHref: highlight.chapterHref,
    };
  }, [activeAnnotation]);

  const handleRecolorAnnotation = useCallback(
    async (color: Highlight["color"]) => {
      if (!activeAnnotation) return;
      // Remember the chosen colour as the default for new marks.
      defaultMarkColorRef.current = color;
      setDefaultMarkColor(color);
      try {
        const updated = await recolorHighlight(activeAnnotation.highlight, color);
        if (highlightsRef.current) {
          highlightsRef.current = highlightsRef.current.map((highlight) =>
            highlight.id === updated.id ? updated : highlight,
          );
        }
        // Re-adding under the same CFI replaces the drawn mark in the new color.
        if (viewRef.current) applyHighlight(viewRef.current, updated);
        bumpAnnotationsRevision((c) => c + 1);
      } catch (recolorError) {
        log.error("failed to recolor annotation", recolorError);
        failToastRef.current("annotations.updateFailed", recolorError);
      }
      setActiveAnnotation(null);
    },
    [activeAnnotation, bumpAnnotationsRevision, highlightsRef, setActiveAnnotation, viewRef],
  );

  const handleRemoveAnnotation = useCallback(async () => {
    if (!activeAnnotation) return;
    const { highlight } = activeAnnotation;
    try {
      await deleteAnnotation(highlight.id);
      if (highlightsRef.current) {
        highlightsRef.current = highlightsRef.current.filter((item) => item.id !== highlight.id);
      }
      if (viewRef.current && highlight.cfiRange) {
        removeHighlight(viewRef.current, highlight.cfiRange);
      }
      bumpAnnotationsRevision((c) => c + 1);
    } catch (removeError) {
      log.error("failed to remove annotation", removeError);
      failToastRef.current("annotations.deleteFailed", removeError);
    }
    setActiveAnnotation(null);
  }, [activeAnnotation, bumpAnnotationsRevision, highlightsRef, setActiveAnnotation, viewRef]);

  const handleAddNoteForAnnotation = useCallback(() => {
    const target = activeAnnotationTarget();
    if (!target) return;
    openNoteEditorForPassage(target);
    setActiveAnnotation(null);
  }, [activeAnnotationTarget, openNoteEditorForPassage, setActiveAnnotation]);

  const handleAskAIAboutAnnotation = useCallback(() => {
    const target = activeAnnotationTarget();
    if (!target) return;
    requestAskAi(target);
    setActiveAnnotation(null);
  }, [activeAnnotationTarget, requestAskAi, setActiveAnnotation]);

  // ── Against the guided-reading unit ────────────────────────────────────────

  const navigatorTarget = useCallback((): ActionTarget | null => {
    const unit = textUnitNavigator.current;
    if (!unit) return null;
    return {
      text: unit.text,
      cfiRange: unit.cfiRange,
      chapterHref: currentChapterHrefRef.current,
    };
  }, [currentChapterHrefRef, textUnitNavigator]);

  const handleNavigatorMark = useCallback(
    async (style: NonNullable<Highlight["style"]>) => {
      const target = navigatorTarget();
      if (!target) return;
      await saveMark(target, defaultMarkColorRef.current, style);
    },
    [navigatorTarget, saveMark],
  );

  const handleNavigatorAddNote = useCallback(() => {
    const target = navigatorTarget();
    if (!target) return;
    openNoteEditorForPassage(target);
  }, [navigatorTarget, openNoteEditorForPassage]);

  const handleNavigatorLookUp = useCallback(() => {
    runLookupAction(pluginInputFor(navigatorTarget(), "navigator"));
  }, [navigatorTarget, pluginInputFor, runLookupAction]);

  const handleNavigatorAskAI = useCallback(() => {
    const target = navigatorTarget();
    if (!target) return;
    requestAskAi(target);
  }, [navigatorTarget, requestAskAi]);

  /**
   * The input a plugin selection action receives, for whichever surface is
   * asking. Callers name the surface; which passage that means stays in here.
   */
  const pluginInputForSource = useCallback(
    (source: SelectionActionSource): SelectionActionInput | null => {
      if (source === "selection") {
        if (!selection) return null;
        return pluginInputFor(
          {
            text: selection.text,
            cfiRange: selection.cfiRange,
            chapterHref: selection.chapterHref,
          },
          "selection",
          selection.context,
        );
      }
      if (source === "navigator") return pluginInputFor(navigatorTarget(), "navigator");
      return pluginInputFor(activeAnnotationTarget(), "annotation");
    },
    [activeAnnotationTarget, navigatorTarget, pluginInputFor, selection],
  );

  // ── The note editor these actions open ────────────────────────────────────

  const handleSaveNote = useCallback(
    async (content: string) => {
      if (!noteTarget || !selectedBook) return;
      try {
        if (currentNote) {
          const updated = await updateNote(currentNote.id, content);
          if (updated && notesRef.current) {
            notesRef.current = notesRef.current.map((note) =>
              note.id === updated.id ? updated : note,
            );
          }
        } else {
          const note = await createNote(
            selectedBook.id,
            noteTarget.cfiRange,
            noteTarget.chapterHref,
            noteTarget.text,
            content,
          );
          if (notesRef.current) notesRef.current = [...notesRef.current, note];
          // Draw the dashed marker unless the passage is already highlighted
          // (the highlight is the visual there; see applyNotes).
          if (
            viewRef.current &&
            note.cfiRange &&
            !highlightsRef.current?.some((highlight) => highlight.cfiRange === note.cfiRange)
          ) {
            applyNote(viewRef.current, note);
          }
        }
        bumpAnnotationsRevision((c) => c + 1);
        setNoteEditorOpen(false);
        setNoteTarget(null);
        setCurrentNote(null);
        clearSelection();
      } catch (noteError) {
        // The editor stays open with the draft intact; the toast says why.
        log.error("failed to save note", noteError);
        failToastRef.current("annotations.noteSaveFailed", noteError);
      }
    },
    [
      bumpAnnotationsRevision,
      clearSelection,
      currentNote,
      highlightsRef,
      noteTarget,
      notesRef,
      selectedBook,
      viewRef,
    ],
  );

  const closeNoteEditor = useCallback(() => {
    setNoteEditorOpen(false);
    setNoteTarget(null);
    setCurrentNote(null);
    clearSelection();
  }, [clearSelection]);

  return {
    copyTargetText,
    // selection
    handleHighlight,
    handleUnderline,
    handleAddNote,
    handleLookUp,
    handleAskAI,
    // active annotation
    handleRecolorAnnotation,
    handleRemoveAnnotation,
    handleAddNoteForAnnotation,
    handleAskAIAboutAnnotation,
    // guided-reading unit
    handleNavigatorMark,
    handleNavigatorAddNote,
    handleNavigatorLookUp,
    handleNavigatorAskAI,
    openExistingNote,
    pluginInputForSource,
    // note editor
    noteEditor: {
      isOpen: noteEditorOpen,
      target: noteTarget,
      current: currentNote,
      save: handleSaveNote,
      close: closeNoteEditor,
    },
  };
}
