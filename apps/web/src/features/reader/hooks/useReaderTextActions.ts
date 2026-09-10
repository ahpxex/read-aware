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
import { useAtomValue, useSetAtom } from "jotai";
import { askAiRequestAtom } from "../../ai/state/chat-intent";
import { selectionActionsAtom } from "../../plugins/state/plugin-store";
import { runPluginContribution } from "../../plugins/lib/run-result";
import type { SelectionActionInput, SelectionActionSource } from "../../plugins/lib/plugin-types";
import { createHighlight } from "../../annotations/lib/annotation-db";
import { changeObservedAnnotation } from "../../annotations/lib/native-annotation-mutations";
import { useReaderNoteEditor } from "./useReaderNoteEditor";
import type { ActionTarget } from "../lib/reader-types";
import {
  getDefaultMarkColor,
  setDefaultMarkColor,
} from "../../annotations/lib/annotation-prefs";
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

  const dispatchAskAi = useSetAtom(askAiRequestAtom);
  const pluginSelectionActions = useAtomValue(selectionActionsAtom);
  const lookupAction =
    pluginSelectionActions.find((action) => action.role === "lookup" && action.state?.visible !== false && action.state?.enabled !== false) ?? null;

  const reportNoteFailure = useCallback((error: unknown) => {
    log.error("failed to save note", error);
    failToastRef.current("annotations.noteSaveFailed", error);
  }, []);
  const noteEditor = useReaderNoteEditor(selectedBook?.id, clearSelection, reportNoteFailure);
  const openNoteEditorFor = noteEditor.open;

  const copyTargetText = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await copyText(text);
    } catch {
      // Clipboard access can be unavailable outside a trusted user gesture.
    }
  }, []);

  /** Open the note editor for a passage — editing the note already on it, if any. */
  const openNoteEditorForPassage = useCallback(
    (target: ActionTarget) => {
      const existing = target.cfiRange
        ? notesRef.current?.find((note) => note.cfiRange === target.cfiRange)
        : undefined;
      if (existing) {
        openNoteEditorFor({
          text: existing.text,
          cfiRange: existing.cfiRange,
          chapterHref: existing.chapterHref,
        }, existing);
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
    openNoteEditorFor({
      text: note.text,
      cfiRange: note.cfiRange,
      chapterHref: note.chapterHref,
    }, note);
  }, [openNoteEditorFor]);

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
        { presentation: lookupAction.presentation, owner: lookupAction.run },
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
        await createHighlight(
          selectedBook.id,
          target.cfiRange,
          target.chapterHref,
          target.text,
          color,
          style,
        );
        return true;
      } catch (highlightError) {
        log.error("failed to save highlight", highlightError);
        failToastRef.current("annotations.saveFailed", highlightError);
        return false;
      }
    },
    [selectedBook],
  );

  // ── Against the live selection ─────────────────────────────────────────────

  const handleHighlight = useCallback(
    async (
      color: Highlight["color"] = getDefaultMarkColor(),
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
    void handleHighlight(getDefaultMarkColor(), "underline");
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
      await saveMark(target, getDefaultMarkColor(), style);
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
