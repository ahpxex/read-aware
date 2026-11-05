import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";
import type { AgentTurnState } from "./turn-state";
import { AppError, type ReadingLocation, type ReadingSessionSnapshot, type ReadingStep } from "@read-aware/core";
import { readingContextCall } from "../runtime/reading-context-policy";
import { buildSelectionTools } from "./selection-tools";
import { buildEmphasisTools } from "./emphasis-tools";
import { buildReaderFocusTool } from "./reader-focus-tool";
import { bool, int, num, obj, oneOf, opt, str } from "@earendil-works/pi-schema";

/**
 * A selection is host-captured context.  Keep it available through the
 * narrative fence only when its version is still the active reader source;
 * arbitrary location text remains withheld.  The controller applies the same
 * book/version check when it publishes a selection.
 */
function currentSourceSelection(snapshot: ReadingSessionSnapshot) {
  const selection = snapshot.selection;
  const range = selection?.range;
  if (
    snapshot.status !== "ready" ||
    !snapshot.bookId ||
    !snapshot.location ||
    !range ||
    snapshot.location.bookId !== snapshot.bookId ||
    range.bookId !== snapshot.bookId ||
    range.contentVersion !== snapshot.location.contentVersion
  ) {
    return null;
  }
  return selection;
}

export function buildReaderTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  const openBook: AgentTool = {
    name: "open_book",
    label: "Open book",
    description:
      "Open a shelf book in the reader. Optionally jump to an annotation, extracted chapter index, CFI anchor, chapter href, fraction (0 to 1), or source sectionIndex. sectionIndex is zero-based original reading order, not TOC ordinal or printed page label; requires contentVersion and no other locator. For PDF/comics each source section is one page. Pass contentVersion when reusing a reported location. bookId defaults to the current book. Returns actual completion.",
    parameters: obj({
      bookId: opt(str()),
      annotationId: opt(str()),
      chapterIndex: opt(num()),
      sectionIndex: opt(int({ minimum: 0 })),
      anchor: opt(str()),
      chapterHref: opt(str()),
      fraction: opt(num({ minimum: 0, maximum: 1 })),
      contentVersion: opt(str()),
      location: opt(
        obj(
          {
            bookId: str(),
            contentVersion: str(),
            cfi: opt(str()),
            href: opt(str()),
            fraction: opt(num()),
            textQuote: opt(
              obj({
                exact: str(),
                prefix: opt(str()),
                suffix: opt(str()),
              }),
            ),
          },
          { description: "Copy the complete location returned by get_navigation_toc or find_book_locations." },
        ),
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const {
        bookId,
        annotationId,
        chapterIndex,
        sectionIndex,
        anchor,
        chapterHref,
        fraction,
        contentVersion,
        location,
      } = params as {
        bookId?: string;
        annotationId?: string;
        chapterIndex?: number;
        sectionIndex?: number;
        anchor?: string;
        chapterHref?: string;
        fraction?: number;
        contentVersion?: string;
        location?: ReadingLocation;
      };
      if (
        sectionIndex !== undefined &&
        (!Number.isSafeInteger(sectionIndex) ||
          sectionIndex < 0 ||
          !contentVersion ||
          annotationId !== undefined ||
          chapterIndex !== undefined ||
          anchor !== undefined ||
          chapterHref !== undefined ||
          fraction !== undefined ||
          location !== undefined)
      ) {
        throw new AppError("reader/invalid-target", "Source section requires contentVersion and no other locator");
      }
      if (
        location &&
        (annotationId ||
          chapterIndex !== undefined ||
          sectionIndex !== undefined ||
          anchor ||
          chapterHref ||
          fraction !== undefined ||
          contentVersion ||
          (bookId && bookId !== location.bookId))
      )
        throw new Error("Use location or individual locator fields, not conflicting targets");
      const target = resolveBookId(scope, bookId ?? location?.bookId);
      const book = await deps.library.getBook(target);
      if (!book) throw new Error(`unknown book: ${target}`);

      let targetAnchor = anchor;
      let targetHref = chapterHref;
      if (annotationId) {
        const annotation = await deps.annotations.getAnnotation(annotationId);
        if (!annotation || annotation.bookId !== target)
          throw new Error(`annotation not found in ${target}: ${annotationId}`);
        targetAnchor = annotation.anchor;
        targetHref = annotation.chapterHref;
        if (!targetAnchor && !targetHref) throw new Error("This annotation has no navigable location");
      } else if (chapterIndex !== undefined) {
        const chapter = (await deps.bookText.getToc(target)).find((entry) => entry.index === chapterIndex);
        if (!chapter) throw new Error(`chapter ${chapterIndex} not found in ${target}`);
        targetHref = chapter.hrefs?.[0];
        if (!targetHref) throw new Error(`chapter ${chapterIndex} has no navigable location`);
      }

      const receipt = location
        ? await deps.reader.goTo({ ...location, bookId: target }, signal)
        : targetAnchor || targetHref || fraction !== undefined || sectionIndex !== undefined || contentVersion
          ? await deps.reader.goTo(
              {
                bookId: target,
                cfi: targetAnchor,
                href: targetHref,
                fraction,
                contentVersion,
                ...(sectionIndex !== undefined ? { sectionIndex } : {}),
              },
              signal,
            )
          : await deps.reader.openBook(target, signal);
      return textResult({
        opened: true,
        ...receipt,
        bookId: target,
        title: book.title,
        anchor: targetAnchor,
        chapterHref: targetHref,
      });
    },
  };

  const session: AgentTool = {
    name: "get_reading_session",
    label: "Reading session",
    description:
      "Read the actual active reader status, versioned location, visible text, selection, history availability and current pagination. change reports the origin and reason of the last host publication; command acknowledgements are stamped by the host, while unattributed renderer or lifecycle feedback uses system. It describes a coalescible snapshot update, not human presence, a complete causal audit or replayable events; sessionId is the generation identity. readerDemand reports recent render/relocation activity and its 1.5-second idleAt deadline; it is the same signal used to yield background text extraction, not proof of human presence or a durable event log. visibleTextState distinguishes available, rendered empty, and unavailable text; PDF text includes intersecting text runs, not OCR or exact glyph/overlay visibility. truncated means the preview is incomplete. pagination.section is zero-based source order including non-linear sections. pagination.screen counts viewport/spread steps only within the current reflowable section, not columns, printed page labels or whole-book pages; null for fixed layout, continuous scroll or transient geometry. It changes with window/font/layout and is not a persistent navigation target. selection.range can be passed unchanged to read_book_range. A book-scoped turn does not expose another book's viewport or selection.",
    parameters: obj({}),
    execute: async (_id, _params, signal) => {
      const call = readingContextCall(deps.readingContextPolicy, signal, state?.readingContextPermissions);
      try {
        call.assertAllowed();
        const snapshot = await call.wait(deps.reader.getSession());
        if (scope.kind === "book" && snapshot.bookId !== scope.bookId)
          return textResult({ status: "not-active", bookId: scope.bookId });
        const privateText = !call.permissions.selection || !call.permissions.surrounding;
        if (privateText || (state?.spoilerFence && !state.spoilerPermissionGranted)) {
          const safe = structuredClone(snapshot);
          safe.visibleText = "";
          // An explicit, version-matched reader selection is the user's
          // current source context. Preserve its complete range for an
          // annotation request while retaining the fence for arbitrary text.
          safe.selection = privateText ? null : currentSourceSelection(snapshot);
          safe.visibleTextState = { status: "unavailable", source: null, truncated: false, reason: "withheld" };
          if (safe.location) delete safe.location.textQuote;
          if (safe.mode.position) delete safe.mode.position.location.textQuote;
          return textResult({
            ...safe,
            textAccess: privateText
              ? "Viewport text is withheld by the reader's privacy settings."
              : "Use the turn's original reading_cursor.visible_text; navigation does not grant spoiler access.",
          });
        }
        return textResult(snapshot);
      } finally {
        call.dispose();
      }
    },
  };
  const control: AgentTool = {
    name: "navigate_reading",
    label: "Navigate reading",
    description:
      "Move back/forward through explicit jumps and ordinary in-book links; turn next/previous page; next-chapter/previous-chapter follows flattened TOC targets (including subsections), while next-section/previous-section follows linear source sections; start/end jumps to book boundaries. Chapter steps skip consecutive duplicate targets, stay put at TOC boundaries or without a TOC; an unknown current TOC position uses first/last target. These are not printed chapter numbers. Section steps skip non-linear notes. Chapter/section/start/end jumps enter shared history; ordinary page and unit steps do not. next-unit/previous-unit continues the active text mode, reporting moved/start-of-book/end-of-book; return-to-unit requires get_reading_session.mode.position. close closes reading. reload reopens the current source in a new session and clears selection. Virtual sections preserve a source-verified unchanged location across reorder; changed/missing/legacy locations and file sources restart at the beginning; use only for an explicit refresh request. A virtual provider may fetch new content, but reload does not itself refresh its private cache. Returns the actual completed location, not dispatch acknowledgement or permission to read spoilers. Use open_book for a specific target.",
    parameters: obj({
      action: oneOf([
        "back",
        "forward",
        "next",
        "previous",
        "next-section",
        "previous-section",
        "next-chapter",
        "previous-chapter",
        "start",
        "end",
        "next-unit",
        "previous-unit",
        "return-to-unit",
        "close",
        "reload",
      ]),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const current = await deps.reader.getSession();
      if (scope.kind === "book" && current.bookId !== scope.bookId)
        throw new Error("This book is not the active reader");
      const { action } = params as {
        action:
          | ReadingStep
          | "back"
          | "forward"
          | "next-unit"
          | "previous-unit"
          | "return-to-unit"
          | "close"
          | "reload";
      };
      const guard = {
        sessionId: current.sessionId ?? undefined,
        ...(scope.kind === "book" ? { bookId: scope.bookId } : {}),
      };
      if (action === "close") {
        await deps.reader.close(signal, guard);
        return textResult({ status: "completed", closed: true });
      }
      if (action === "reload") return textResult(await deps.reader.reload(signal, guard));
      if (action === "return-to-unit") return textResult(await deps.reader.returnToMode(signal, guard));
      if (action === "next-unit" || action === "previous-unit")
        return textResult(await deps.reader.stepMode(action === "next-unit" ? "next" : "previous", signal, guard));
      const result =
        action === "back"
          ? await deps.reader.back(signal, guard)
          : action === "forward"
            ? await deps.reader.forward(signal, guard)
            : await deps.reader.step(action, signal, guard);
      return textResult(result);
    },
  };
  const playback: AgentTool = {
    name: "control_read_aloud",
    label: "Control read aloud",
    description:
      "Start or stop read aloud in the active text-unit reading mode. Inspect get_reading_session.playback first; an inactive mode or missing unit/voice is unavailable. Start completes only when audio starts, not when synthesis is requested. Does not grant access to passage text. Stop does not rewind the reading position.",
    parameters: obj({ action: oneOf(["start", "stop"]) }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const current = await deps.reader.getSession();
      if (!current.sessionId || (scope.kind === "book" && current.bookId !== scope.bookId))
        throw new Error("This book is not the active reader");
      const { action } = params as { action: "start" | "stop" };
      return textResult(
        await deps.reader.controlPlayback(action, signal, {
          sessionId: current.sessionId,
          ...(scope.kind === "book" ? { bookId: scope.bookId } : {}),
        }),
      );
    },
  };
  const mode: AgentTool = {
    name: "configure_reading_mode",
    label: "Configure reading mode",
    description:
      "Enable or disable a text-unit reading mode. Discover registered providers and their units in get_reading_session.mode.availableModes. selectModeKey chooses one of those keys; modeKey is only a precondition for the previously selected provider. Without unitId a new provider uses its saved/default unit. Selection preserves no old provider's ordinal and waits for actual indexing (or inactive cleanup); empty means no units, failure rejects. It never installs providers or starts audio.",
    parameters: obj({
      active: bool(),
      modeKey: opt(str()),
      selectModeKey: opt(str()),
      unitId: opt(str()),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const current = await deps.reader.getSession();
      if (!current.sessionId || (scope.kind === "book" && current.bookId !== scope.bookId))
        throw new Error("This book is not the active reader");
      return textResult(
        await deps.reader.configureMode(params as import("@read-aware/core").ReadingModeConfiguration, signal, {
          sessionId: current.sessionId,
          ...(scope.kind === "book" ? { bookId: scope.bookId } : {}),
        }),
      );
    },
  };
  const controls: AgentTool = {
    name: "set_reader_controls",
    label: "Reader controls",
    description:
      "Show or hide the current reader's header and docked panels. Query get_reading_session.controls first. This changes only chrome visibility: it does not open/close a book, change saved panel choices, start/stop audio, or move the reading position. Completes when the UI commits. Use only for an explicit user request.",
    parameters: obj({ visible: bool() }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const current = await deps.reader.getSession();
      if (!current.sessionId || (scope.kind === "book" && current.bookId !== scope.bookId))
        throw new Error("This book is not the active reader");
      return textResult(
        await deps.reader.setControls((params as { visible: boolean }).visible, signal, {
          sessionId: current.sessionId,
          ...(scope.kind === "book" ? { bookId: scope.bookId } : {}),
        }),
      );
    },
  };
  const panelState: AgentTool = {
    name: "get_reader_panels",
    label: "Reader panels",
    description:
      "Read which TOC, annotations, appearance and chat panels are selected and visible, their shared preferred TOC/chat widths, and docked/exclusive layout in the active reader. Preferred CSS-pixel widths are ignored in exclusive (narrow-window) layout. Returns no book content. Null means no ready panel surface; a book-scoped turn cannot inspect another book's panels.",
    parameters: obj({}),
    execute: async () => {
      const snapshot = await deps.reader.getPanels();
      return textResult(scope.kind === "book" && snapshot?.bookId !== scope.bookId ? null : snapshot);
    },
  };
  const panelControl: AgentTool = {
    name: "set_reader_panel",
    label: "Set reader panel",
    description:
      "Explicitly open or close toc, annotations, appearance or chat for a user request. Query get_reader_panels first. Opening also reveals reader controls; In docked layout TOC/chat choices persist per book; in exclusive (narrow-window) layout they are transient full-screen sheets, only one open at a time, and close when controls hide. Annotations/appearance are always transient. Completes after required persistence and a UI commit, not animation or data loading. Does not change reading position or start an AI turn.",
    parameters: obj({
      panel: oneOf(["toc", "annotations", "appearance", "chat"]),
      open: bool(),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const current = await deps.reader.getPanels();
      if (!current) throw new AppError("reader/unavailable", "Reader panels are not attached");
      if (scope.kind === "book" && current.bookId !== scope.bookId)
        throw new AppError("reader/superseded", "This book is not the active reader");
      const { panel, open } = params as { panel: import("@read-aware/core").ReaderPanel; open: boolean };
      return textResult(
        await deps.reader.setPanel(panel, open, signal, { bookId: current.bookId, sessionId: current.sessionId }),
      );
    },
  };
  const panelWidth: AgentTool = {
    name: "set_reader_panel_width",
    label: "Resize reader panel",
    description:
      "Set a preferred TOC/chat width for an explicit user request. Integer 240..640 CSS pixels, shared across books and persisted on this device. Query get_reader_panels first. Completes after persistence and a matching UI commit; does not open the panel, reveal controls, move reading position or focus. Exclusive narrow-window layout ignores the saved width until docked layout resumes. Cancellation cannot undo an already dispatched write.",
    parameters: obj({
      panel: oneOf(["toc", "chat"]),
      width: int({ minimum: 240, maximum: 640 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const current = await deps.reader.getPanels();
      if (!current) throw new AppError("reader/unavailable", "Reader panels are not attached");
      if (scope.kind === "book" && current.bookId !== scope.bookId)
        throw new AppError("reader/superseded", "This book is not the active reader");
      const { panel, width } = params as { panel: import("@read-aware/core").ResizableReaderPanel; width: number };
      return textResult(
        await deps.reader.setPanelWidth(panel, width, signal, { bookId: current.bookId, sessionId: current.sessionId }),
      );
    },
  };
  return [
    openBook,
    session,
    control,
    playback,
    mode,
    controls,
    panelState,
    panelControl,
    panelWidth,
    buildReaderFocusTool(scope, deps),
    ...buildSelectionTools(scope, deps),
    ...buildEmphasisTools(scope, deps),
  ];
}
