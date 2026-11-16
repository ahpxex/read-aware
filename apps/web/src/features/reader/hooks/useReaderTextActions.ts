/**
 * Everything the reader can DO to a passage: mark it, note it, look it up, ask
 * about it — and the note editor those actions open.
 *
 * Extracted from FoliateReaderView. Three surfaces invoke the same set of verbs
 * against different targets (a live selection, the annotation under the cursor,
 * the guided-reading unit), which is why they belong together: the target
 * differs, the action does not.
 *
 * Note draft lifetime and conditional saving live in useReaderNoteEditor.
 * Default mark colour is read at action time from shared preferences.
 */
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import type { ReadingModePosition, ReadingSelectionSnapshot } from "@read-aware/core";
import { useAtomValue, useSetAtom } from "jotai";
import { askAiRequestAtom } from "../../ai/state/chat-intent";
import { selectionActionsAtom } from "../../plugins/state/plugin-store";
import { runPluginContribution } from "../../plugins/lib/run-result";
import type { SelectionActionInput, SelectionActionSource } from "../../plugins/lib/plugin-types";
import { createHighlight } from "../../annotations/lib/annotation-db";
import { changeObservedAnnotation } from "../../annotations/lib/native-annotation-mutations";
import { useReaderNoteEditor } from "./useReaderNoteEditor";
import type { ActionTarget } from "../lib/reader-types";
import { getDefaultMarkColor, setDefaultMarkColor } from "../../annotations/lib/annotation-prefs";
import type { Highlight, Note } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";
import type { SelectionOverlayRect } from "../lib/selection-overlay";
import { useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reader");

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
  captured?: ReadingSelectionSnapshot;
  /** Where the selection sits in reader-root coordinates; a note card opens beside it. */
  anchorRect?: SelectionOverlayRect | null;
} | null;

type Options = {
  selectedBook: LibraryBook | null;
  selection: LiveSelection;
  activeAnnotation: ActiveAnnotation;
  /** Owned by the view: a relocate clears it, so it cannot live in here. */
  setActiveAnnotation: (value: ActiveAnnotation) => void;
  /** The guided-reading unit currently washed, if that mode is on. */
  textUnitNavigator: {
    current: { text: string; cfiRange: string | null } | null;
    position: ReadingModePosition | null;
  };
  clearSelection: () => void;
  currentChapterHrefRef: RefObject<string | null>;
  /** Receives the stored row of a mark this reader just saved, so it is drawn
   *  without waiting for the next annotation snapshot. */
  onMarkSaved: (highlight: Highlight) => void;
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
  currentChapterHrefRef,
  onMarkSaved,
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

  const onMarkSavedRef = useRef(onMarkSaved);
  onMarkSavedRef.current = onMarkSaved;

  const dispatchAskAi = useSetAtom(askAiRequestAtom);
  const pluginSelectionActions = useAtomValue(selectionActionsAtom);
  const lookupAction =
    pluginSelectionActions.find(
      (action) => action.role === "lookup" && action.state?.visible !== false && action.state?.enabled !== false,
    ) ?? null;

  const reportNoteFailure = useCallback((error: unknown, action: "save" | "delete") => {
    log.error(action === "save" ? "failed to save note" : "failed to delete note", error);
    failToastRef.current(action === "save" ? "annotations.noteSaveFailed" : "annotations.deleteFailed", error);
  }, []);
  const noteEditor = useReaderNoteEditor(selectedBook?.id, clearSelection, reportNoteFailure);
  const openNoteCard = noteEditor.open;

  const copyTargetText = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await copyText(text);
    } catch {
      // Clipboard access can be unavailable outside a trusted user gesture.
    }
  }, []);

  /**
   * Open the note card for a passage at `anchorRect` (its rect in reader-root
   * coordinates; null centers it): the passage's notes, and a field for
   * another. A note tapped in the text opens its passage the same way.
   */
  const openNotesFor = useCallback(
    (target: ActionTarget, anchorRect: SelectionOverlayRect | null) => {
      // Opening saves an open card first and reports its own failures; nothing to catch here.
      void openNoteCard(target, anchorRect);
    },
    [openNoteCard],
  );
  const openExistingNote = useCallback(
    (note: Note, anchorRect: SelectionOverlayRect | null) => {
      openNotesFor({ text: note.text, cfiRange: note.cfiRange, chapterHref: note.chapterHref }, anchorRect);
    },
    [openNotesFor],
  );

  const pluginInputFor = useCallback(
    (target: ActionTarget | null, source: SelectionActionSource, context?: string): SelectionActionInput | null => {
      if (!selectedBook || !target) return null;
      return {
        text: target.text,
        context,
        cfiRange: target.cfiRange,
        range: target.range ? structuredClone(target.range) : null,
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
      void runPluginContribution(lookupAction.pluginId, lookupAction.pluginName, () => lookupAction.run(input), {
        presentation: lookupAction.presentation,
        owner: lookupAction.run,
      });
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
      let saved: Highlight;
      try {
        saved = await createHighlight(selectedBook.id, target.cfiRange, target.chapterHref, target.text, color, style);
      } catch (highlightError) {
        log.error("failed to save highlight", highlightError);
        failToastRef.current("annotations.saveFailed", highlightError);
        return false;
      }
      onMarkSavedRef.current(saved);
      return true;
    },
    [selectedBook],
  );

  // ── Against the live selection ─────────────────────────────────────────────

  const handleHighlight = useCallback(
    async (color: Highlight["color"] = getDefaultMarkColor(), style: NonNullable<Highlight["style"]> = "highlight") => {
      if (!selection) return;
      const saved = await saveMark(
        {
          text: selection.text,
          cfiRange: selection.cfiRange,
          chapterHref: selection.chapterHref,
          range: selection.captured?.range,
        },
        color,
        style,
      );
      if (saved) clearSelection();
    },
    [clearSelection, saveMark, selection],
  );

  const handleUnderline = useCallback(() => {
    void handleHighlight(getDefaultMarkColor(), "underline");
  }, [handleHighlight]);

  const handleLookUp = useCallback(() => {
    if (!selection) return;
    runLookupAction(
      pluginInputFor(
        {
          text: selection.text,
          cfiRange: selection.cfiRange,
          chapterHref: selection.chapterHref,
          range: selection.captured?.range,
        },
        "selection",
        selection.context,
      ),
    );
    clearSelection();
  }, [clearSelection, pluginInputFor, runLookupAction, selection]);

  const handleAddNote = useCallback(() => {
    if (!selection) return;
    openNotesFor(
      {
        text: selection.text,
        cfiRange: selection.cfiRange,
        chapterHref: selection.chapterHref,
        range: selection.captured?.range,
      },
      selection.anchorRect ?? null,
    );
  }, [openNotesFor, selection]);

  const handleAskAI = useCallback(() => {
    if (!selection) return;
    requestAskAi({
      text: selection.text,
      cfiRange: selection.cfiRange,
      chapterHref: selection.chapterHref,
      range: selection.captured?.range,
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
      try {
        // Persist the default before recoloring; failed preferences use the same error surface.
        await setDefaultMarkColor(color);
        await changeObservedAnnotation(activeAnnotation.highlight, { op: "recolorHighlight", color });
      } catch (recolorError) {
        log.error("failed to recolor annotation", recolorError);
        failToastRef.current("annotations.updateFailed", recolorError);
      }
      setActiveAnnotation(null);
    },
    [activeAnnotation, setActiveAnnotation],
  );

  const handleRemoveAnnotation = useCallback(async () => {
    if (!activeAnnotation) return;
    const { highlight } = activeAnnotation;
    try {
      await changeObservedAnnotation(highlight, { op: "remove" });
    } catch (removeError) {
      log.error("failed to remove annotation", removeError);
      failToastRef.current("annotations.deleteFailed", removeError);
    }
    setActiveAnnotation(null);
  }, [activeAnnotation, setActiveAnnotation]);

  const handleAddNoteForAnnotation = useCallback(() => {
    const target = activeAnnotationTarget();
    if (!target) return;
    openNotesFor(target, activeAnnotation?.anchorRect ?? null);
    setActiveAnnotation(null);
  }, [activeAnnotation, activeAnnotationTarget, openNotesFor, setActiveAnnotation]);

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
    const location = textUnitNavigator.position?.location;
    return {
      text: unit.text,
      cfiRange: unit.cfiRange,
      chapterHref: currentChapterHrefRef.current,
      range:
        location && location.bookId === selectedBook?.id && location.cfi === unit.cfiRange
          ? { bookId: location.bookId, contentVersion: location.contentVersion, cfi: location.cfi }
          : null,
    };
  }, [currentChapterHrefRef, textUnitNavigator, selectedBook?.id]);

  const handleNavigatorMark = useCallback(
    async (style: NonNullable<Highlight["style"]>) => {
      const target = navigatorTarget();
      if (!target) return;
      await saveMark(target, getDefaultMarkColor(), style);
    },
    [navigatorTarget, saveMark],
  );

  /** `anchorRect` is the menu's anchor when one opened it; a shortcut has none. */
  const handleNavigatorAddNote = useCallback(
    (anchorRect: SelectionOverlayRect | null = null) => {
      const target = navigatorTarget();
      if (!target) return;
      openNotesFor(target, anchorRect);
    },
    [navigatorTarget, openNotesFor],
  );

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
            range: selection.captured?.range,
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
    noteEditor,
  };
}
