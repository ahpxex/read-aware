import type { DomainActor } from "../../../platform/domain-actor";
import { useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import type { ReadingModeSnapshot } from "@read-aware/core";
import {
  BookmarkSimple,
  CaretLeft,
  ChatCircle,
  ListBullets,
  ListChecks,
  MagnifyingGlass,
  Notebook,
  TextAa,
} from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { useReaderResponsiveLayout } from "../hooks/useReaderResponsiveLayout";
import { Body, Dialog, IconButton, Tooltip, useToast } from "@read-aware/ui";
import { describeError, formatPercent, useLocale, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { ChatPanel } from "../../ai/components/ChatPanel";
import { useBookAnnotations } from "../../annotations/hooks/useBookAnnotations";
import type { LibraryBook } from "../../library/lib/library-types";
import { useBackInterceptor } from "../../../hooks/useBackInterceptor";
import { MenuOverflow, type MenuOverflowEntry } from "../../menus/components/MenuOverflow";
import { coreMenuMeta } from "../../menus/lib/menu-registry";
import { CORE_MENU_DEFAULTS, menuConfigAtom, pluginMenuId, resolveSurfaceLayout } from "../../menus/state/menu-config";
import { PluginHeaderItem } from "../../plugins/components/PluginHeaderCluster";
import { openHeaderActionDialog } from "../../plugins/lib/open-header-action";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import type { RegisteredReaderMode } from "../../plugins/lib/plugin-types";
import { headerActionsAtom } from "../../plugins/state/plugin-store";
import { findTocIndexForHref } from "../lib/epub-utils";
import type { ReadingCursor } from "../lib/reader-types";
import { buildProgressMarks } from "../lib/reader-progress";
import { useReaderPanels } from "../hooks/useReaderPanels";
import { useReaderPanelSizes } from "../hooks/useReaderPanelSizes";
import { useReaderModeSelection } from "../hooks/useReaderModeSelection";
import type { TocEntry } from "../lib/reader-types";
import { ReaderContentsPanel, type ReaderSideView } from "./ReaderContentsPanel";
import { ReaderSearchPanel } from "./ReaderSearchPanel";
import { type ReaderBookmarks } from "./ReaderBookmarkList";
import { useReaderBookmarks } from "../hooks/useReaderBookmarks";
import { useReaderBookmarkActions } from "../hooks/useReaderBookmarkActions";
import { ReaderProgressScrubber } from "./ReaderProgressScrubber";
import { ReaderResizeHandle } from "./ReaderResizeHandle";
import { ReaderAppearanceFields, ReaderAppearanceMenu } from "./ReaderAppearanceMenu";
import { ReaderAppearanceCompact } from "./ReaderAppearanceCompact";
import { ReaderModePicker } from "./ReaderModePicker";
import { ReaderBottomBar, type ReaderBottomBarDrawer } from "./ReaderBottomBar";
import { useToolbarSlotCapacity } from "../hooks/useToolbarSlotCapacity";
import { usePanelSwipeDismiss } from "../hooks/usePanelSwipeDismiss";
import { contributionText } from "../../plugins/lib/plugin-i18n";

/** Panels a phone opens in the bottom bar's drawer. */
type ReaderDrawer = "appearance";

type ReaderShellOverlayProps = {
  visible: boolean;
  visibilityOrigin?: DomainActor;
  onBack: () => void;
  book: LibraryBook;
  progress?: number;
  currentPage?: number;
  totalPages?: number;
  tocEntries?: TocEntry[];
  currentChapterHref?: string | null;
  readingCursor?: ReadingCursor | null;
  onChapterSelect?: (href: string) => void;
  onAnnotationSelect?: (cfiRange: string) => void;
  /** Jump to a position in the book, 0..1 — the progress bar's drag target. */
  onSeek?: (fraction: number) => void;
  /** Installed text-unit mode, if a plugin contributes one. */
  textUnitMode?: RegisteredReaderMode | null;
  textUnitModeActive?: boolean;
  modeSnapshot?: ReadingModeSnapshot;
  onToggleTextUnitMode?: () => void;
  /**
   * The open book is fixed-layout (PDF, comic, pre-paginated EPUB). Its pages
   * cannot re-flow, which rules out both the typography controls and any
   * text-unit mode.
   */
  fixedLayout?: boolean;
};

const log = createLogger("reader");

export function ReaderShellOverlay({
  visible,
  visibilityOrigin,
  onBack,
  book,
  progress,
  currentPage,
  totalPages,
  tocEntries = [],
  currentChapterHref = null,
  readingCursor = null,
  onChapterSelect,
  onAnnotationSelect,
  onSeek,
  textUnitMode = null,
  textUnitModeActive = false,
  modeSnapshot,
  onToggleTextUnitMode,
  fixedLayout = false,
}: ReaderShellOverlayProps) {
  const { t } = useTranslation("reader");
  // A text-unit mode segments running text — there is none to segment in a
  // book whose pages are pre-typeset.
  const textUnitModeAvailable = textUnitMode !== null && !fixedLayout;
  const canSelectMode =
    !fixedLayout &&
    modeSnapshot &&
    modeSnapshot.availableModes.length > 0 &&
    (modeSnapshot.availableModes.length > 1 || !textUnitMode);
  const locale = useLocale();
  const bookId = book.id;
  const modeSelection = useReaderModeSelection(bookId, modeSnapshot);
  const title = book.title;
  const percent = progress != null ? Math.min(100, Math.max(0, progress * 100)) : null;
  const hasPages = totalPages != null && totalPages > 0;
  const progressLabel =
    percent != null
      ? hasPages
        ? t("progress", {
            page: currentPage ?? 0,
            total: totalPages,
            percent: formatPercent(percent),
          })
        : formatPercent(percent)
      : null;
  // Chapter ticks for the progress bar, and the labels its scrub readout names.
  const progressMarks = useMemo(() => buildProgressMarks(tocEntries), [tocEntries]);

  // Docked TOC + chat panels persist per book (restored when the book reopens).
  // Phone-width sheets and the appearance popover are transient: they close
  // with the chrome and never come back on their own.
  const { exclusive: isPhone, origin: layoutOrigin } = useReaderResponsiveLayout();
  const {
    toc: tocOpen,
    chat: notesOpen,
    appearance: appearanceOpen,
    annotations: annotationsOpen,
    chatFocusRequestId,
    chatFocusOrigin,
    setPanel,
    changePanel,
  } = useReaderPanels(bookId, visible, isPhone, visibilityOrigin, layoutOrigin);
  const setTocOpen = (open: boolean) => setPanel("toc", open);
  const setNotesOpen = (open: boolean) => setPanel("chat", open);
  const setAppearanceOpen = (open: boolean) => setPanel("appearance", open);
  const setAnnotationsOpen = (open: boolean) => setPanel("annotations", open);
  // The phone bottom bar's drawer, named by the toolbar icons that open it.
  const drawerId = useId();
  const { sizes, adjust: adjustPanel, persist: persistPanelSizes } = useReaderPanelSizes();

  // Phone-width: the side docks become full-screen sheets (below the top bar),
  // so only one can be open at a time and resizing is meaningless.
  // Left panel: the contents ("toc" panel, docked and remembered per book) or
  // the book's notes ("annotations" panel, so agents and plugins opening the
  // notes land there; it wins while both are open). Right panel ("chat"): the
  // AI conversation or the book search. Each view's header button shows it,
  // or hides its panel when that view is already showing.
  const sideOpen = tocOpen || annotationsOpen;
  const sideView: ReaderSideView = annotationsOpen ? "notes" : "contents";
  // The panel service runs one change at a time, so a switch that touches
  // both left panels opens the target view first and only then closes the
  // other: the panel never slides shut between the two.
  const closeSide = () => {
    void (annotationsOpen ? changePanel("annotations", false) : Promise.resolve(true)).then(() => {
      if (tocOpen) setTocOpen(false);
    });
  };
  const toggleSide = (view: ReaderSideView) => {
    if (sideOpen && sideView === view) return closeSide();
    if (view === "notes") {
      void changePanel("annotations", true).then((opened) => {
        if (opened && tocOpen) setTocOpen(false);
      });
      return;
    }
    void (tocOpen ? Promise.resolve(true) : changePanel("toc", true)).then((opened) => {
      if (opened && annotationsOpen) setAnnotationsOpen(false);
    });
  };
  const sideShows = (view: ReaderSideView) => sideOpen && sideView === view;
  const toggleToc = () => toggleSide("contents");
  const toggleNotesView = () => toggleSide("notes");

  const [rightView, setRightView] = useState<"chat" | "search">("chat");
  // Every opening of the chat panel (its button, Ask AI, an agent) comes with
  // a chat focus request. Each one shows the conversation — except the one the
  // header's search itself caused by opening the panel; a closed panel
  // reopens on the conversation. State adjusted during render, so the right
  // view never lags the panel it describes.
  const [rightSeen, setRightSeen] = useState({ open: notesOpen, focus: chatFocusRequestId });
  const [searchOpening, setSearchOpening] = useState(false);
  if (rightSeen.open !== notesOpen || rightSeen.focus !== chatFocusRequestId) {
    const focused = rightSeen.focus !== chatFocusRequestId;
    setRightSeen({ open: notesOpen, focus: chatFocusRequestId });
    if (focused && searchOpening) setSearchOpening(false);
    else if (focused || !notesOpen) {
      setRightView("chat");
      setSearchOpening(false);
    }
  }
  const rightShows = (view: "chat" | "search") => notesOpen && rightView === view;
  const toggleRight = (view: "chat" | "search") => {
    if (rightShows(view)) return setNotesOpen(false);
    setRightView(view);
    if (notesOpen) return;
    setSearchOpening(view === "search");
    setNotesOpen(true);
  };
  const toggleNotes = () => toggleRight("chat");
  const toggleContentsSearch = () => toggleRight("search");

  // Android back gesture: a phone full-screen sheet is a deeper layer, so back
  // closes it (chat first — it renders on top) instead of unwinding the whole
  // reader back to the shelf. Docked desktop/tablet panels don't occlude the
  // page, so there back keeps its usual close-the-book meaning.
  useBackInterceptor(() => {
    if (!visible || !isPhone) return false;
    if (appearanceOpen || annotationsOpen) {
      if (appearanceOpen) setAppearanceOpen(false);
      if (annotationsOpen) setAnnotationsOpen(false);
      return true;
    }
    if (notesOpen) {
      setNotesOpen(false);
      return true;
    }
    if (tocOpen) {
      setTocOpen(false);
      return true;
    }
    return false;
  });

  // The book's highlights and notes, shown in a popover opened from the header.
  // Observes committed annotation results, including plugin/Agent and remote writes.
  const {
    annotations,
    loadFailed: annotationsLoadFailed,
    loadErrorCode: annotationsLoadErrorCode,
    isLoading: annotationsLoading,
    refresh: refreshAnnotations,
    remove: removeAnnotation,
  } = useBookAnnotations(bookId);
  const { toast } = useToast();
  const activeTocIndex = findTocIndexForHref(tocEntries, currentChapterHref);
  const currentChapterLabel = activeTocIndex >= 0 ? (tocEntries[activeTocIndex]?.label ?? null) : null;

  // The book's bookmarks live in the notes list; the contents search finds them too.
  const { bookmarks, failed: bookmarksFailed } = useReaderBookmarks(bookId);
  const bookmarkActions = useReaderBookmarkActions(currentChapterLabel ?? undefined);
  const bookmarkSection: ReaderBookmarks = {
    bookmarks,
    failed: bookmarksFailed,
    onOpen: (bookmark) => void bookmarkActions.open(bookmark),
    onRename: (bookmark, name) => void bookmarkActions.rename(bookmark, name),
    onRemove: (bookmark) => void bookmarkActions.remove(bookmark),
  };

  // User-arranged right cluster (settings → Menus).
  const { t: tMenus } = useTranslation("settings");
  const menuConfig = useAtomValue(menuConfigAtom);
  const readerPluginActions = useAtomValue(headerActionsAtom).filter(
    (action) => action.surface === "reader" && action.state?.visible !== false,
  );
  const readerCoreItems = CORE_MENU_DEFAULTS.readerHeader.filter(
    (id) => id !== "core:navigator" || textUnitMode !== null || canSelectMode,
  );
  const readerLayout = resolveSurfaceLayout(menuConfig.readerHeader, [
    ...readerCoreItems,
    ...readerPluginActions.map((action) => pluginMenuId(action.key)),
  ]);
  // Phones arrange their own bottom toolbar (Settings → Menus), contents and
  // notes included; back and the overflow menu stay fixed in the top bar.
  const toolbarLayout = resolveSurfaceLayout(menuConfig.readerToolbar, [
    ...CORE_MENU_DEFAULTS.readerToolbar.filter(
      (id) => id !== "core:navigator" || textUnitMode !== null || canSelectMode,
    ),
    ...readerPluginActions.map((action) => pluginMenuId(action.key)),
  ]);

  const coreReaderNodes: Record<string, React.ReactNode | null> = {
    "core:bookmark": (
      <Tooltip content={t("addBookmark")} side="bottom" className="pointer-events-auto">
        <IconButton
          size="sm"
          label={t("addBookmark")}
          onClick={() => void bookmarkActions.add()}
          icon={<BookmarkSimple size={18} aria-hidden="true" />}
        />
      </Tooltip>
    ),
    "core:find": (
      <Tooltip content={t("contentsSearchLabel")} side="bottom" className="pointer-events-auto">
        <IconButton
          size="sm"
          label={t("contentsSearchLabel")}
          aria-pressed={rightShows("search")}
          onClick={toggleContentsSearch}
          className={cn(rightShows("search") && "text-fg")}
          icon={<MagnifyingGlass size={18} weight={rightShows("search") ? "bold" : "regular"} aria-hidden="true" />}
        />
      </Tooltip>
    ),
    "core:navigator":
      textUnitModeAvailable || canSelectMode ? (
        <div className="flex items-center gap-1">
          {textUnitModeAvailable && textUnitMode ? (
            <Tooltip
              content={resolvePluginText(textUnitMode.copy.title, locale)}
              side="bottom"
              className="pointer-events-auto"
            >
              <IconButton
                size="sm"
                label={resolvePluginText(
                  textUnitModeActive ? textUnitMode.copy.exit : textUnitMode.copy.enable,
                  locale,
                )}
                aria-pressed={textUnitModeActive}
                onClick={onToggleTextUnitMode}
                className={cn(textUnitModeActive && "text-fg")}
                icon={renderPluginIcon(textUnitMode.icon, 18, textUnitModeActive ? "bold" : "regular")}
              />
            </Tooltip>
          ) : null}
          {canSelectMode && modeSnapshot && <ReaderModePicker key={bookId} mode={modeSnapshot} {...modeSelection} />}
        </div>
      ) : null,
    "core:appearance": (
      <ReaderAppearanceMenu
        bookId={bookId}
        fixedLayout={fixedLayout}
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
      />
    ),
    "core:chat": (
      <Tooltip content={t("chat")} side="bottom" className="pointer-events-auto">
        <IconButton
          size="sm"
          label={t("chat")}
          aria-pressed={rightShows("chat")}
          onClick={toggleNotes}
          className={cn(rightShows("chat") && "text-fg")}
          icon={<ChatCircle size={18} weight={rightShows("chat") ? "bold" : "regular"} aria-hidden="true" />}
        />
      </Tooltip>
    ),
  };

  const coreReaderRun: Record<string, (() => void) | undefined> = {
    "core:toc": toggleToc,
    "core:find": toggleContentsSearch,
    "core:bookmark": () => void bookmarkActions.add(),
    "core:notes": toggleNotesView,
    "core:navigator": textUnitModeAvailable ? onToggleTextUnitMode : undefined,
    "core:chat": toggleNotes,
    "core:appearance": () => setAppearanceOpen(true),
  };
  const menuSurface = isPhone ? "readerToolbar" : "readerHeader";
  const toOverflowEntry = (id: string): MenuOverflowEntry | null => {
    if (id.startsWith("plugin:")) {
      const action = readerPluginActions.find((entry) => pluginMenuId(entry.key) === id);
      if (!action) return null;
      return {
        id,
        label: contributionText(action.title),
        disabled: action.state?.enabled === false,
        checked: action.state?.checked,
        icon: renderPluginIcon(action.icon, 16),
        run: () =>
          void openHeaderActionDialog(action, {
            book: { id: book.id, title: book.title, author: book.author },
          }),
      };
    }
    const meta = coreMenuMeta(menuSurface, id);
    if (!meta) return null;
    if (id === "core:navigator" && canSelectMode) {
      return {
        id,
        label: String(tMenus(`menus.items.${meta.labelKey}` as never)),
        icon: <meta.Icon size={16} weight="regular" aria-hidden="true" />,
        node: coreReaderNodes[id],
      };
    }
    const run = coreReaderRun[id];
    if (!run) return null;
    return {
      id,
      label:
        id === "core:navigator" && textUnitMode
          ? resolvePluginText(textUnitMode.copy.menuLabel, locale)
          : String(tMenus(`menus.items.${meta.labelKey}` as never)),
      icon:
        id === "core:navigator" && textUnitMode ? (
          renderPluginIcon(textUnitMode.icon, 16)
        ) : (
          <meta.Icon size={16} weight="regular" aria-hidden="true" />
        ),
      run,
    };
  };
  const readerOverflowEntries = readerLayout.overflow
    .map(toOverflowEntry)
    .filter((entry): entry is MenuOverflowEntry => entry !== null);

  const removeAnnotationReporting = (id: string) =>
    void removeAnnotation(id).catch((error) => {
      log.error("failed to remove annotation", error);
      toast({
        variant: "destructive",
        title: t("annotations.deleteFailed"),
        description: describeError(error).body,
      });
    });

  // Phone widths: the arranged toolbar items render in order while they fit
  // the width; the rest, and everything arranged into overflow, sit behind
  // the top bar's "More".
  const { rowRef: toolbarRowRef, capacity: toolbarCapacity } = useToolbarSlotCapacity(isPhone);
  const toolbarInline = toolbarLayout.visible.slice(0, toolbarCapacity);
  const toolbarModePickerEntry: MenuOverflowEntry | null =
    toolbarInline.includes("core:navigator") && textUnitModeAvailable && canSelectMode && modeSnapshot
      ? {
          // The slot holds the text-unit toggle; the mode provider picker
          // that shares it in the header moves into the menu.
          id: "core:navigator:provider",
          label: String(tMenus("menus.items.navigator")),
          icon: <ListChecks size={16} weight="regular" aria-hidden="true" />,
          node: <ReaderModePicker key={bookId} mode={modeSnapshot} {...modeSelection} />,
        }
      : null;
  const toolbarOverflowEntries = [
    ...[...toolbarLayout.visible.slice(toolbarInline.length), ...toolbarLayout.overflow].map(toOverflowEntry),
    toolbarModePickerEntry,
  ].filter((entry): entry is MenuOverflowEntry => entry !== null);
  const toolbarNode = (id: string): ReactNode => {
    if (id.startsWith("plugin:")) {
      const action = readerPluginActions.find((entry) => pluginMenuId(entry.key) === id);
      return action ? (
        <PluginHeaderItem
          key={id}
          variant="toolbar"
          action={action}
          input={{ book: { id: book.id, title: book.title, author: book.author } }}
          buttonClassName="pointer-events-auto"
        />
      ) : null;
    }
    switch (id) {
      case "core:toc":
        return (
          <IconButton
            key={id}
            size="toolbar"
            label={t("tableOfContents")}
            aria-pressed={sideShows("contents")}
            onClick={toggleToc}
            className={cn(sideShows("contents") && "text-fg")}
            icon={<ListBullets size={20} weight={sideShows("contents") ? "bold" : "regular"} aria-hidden="true" />}
          />
        );
      case "core:notes":
        return (
          <IconButton
            key={id}
            size="toolbar"
            label={t("notes")}
            aria-pressed={sideShows("notes")}
            onClick={toggleNotesView}
            className={cn(sideShows("notes") && "text-fg")}
            icon={<Notebook size={20} weight={sideShows("notes") ? "bold" : "regular"} aria-hidden="true" />}
          />
        );
      case "core:navigator":
        if (textUnitModeAvailable && textUnitMode) {
          return (
            <IconButton
              key={id}
              size="toolbar"
              label={resolvePluginText(textUnitModeActive ? textUnitMode.copy.exit : textUnitMode.copy.enable, locale)}
              aria-pressed={textUnitModeActive}
              onClick={onToggleTextUnitMode}
              className={cn(textUnitModeActive && "text-fg")}
              icon={renderPluginIcon(textUnitMode.icon, 20, textUnitModeActive ? "bold" : "regular")}
            />
          );
        }
        return canSelectMode && modeSnapshot ? (
          <ReaderModePicker key={`${id}:${bookId}`} variant="toolbar" mode={modeSnapshot} {...modeSelection} />
        ) : null;
      case "core:bookmark":
        return (
          <IconButton
            key={id}
            size="toolbar"
            label={t("addBookmark")}
            onClick={() => void bookmarkActions.add()}
            icon={<BookmarkSimple size={20} aria-hidden="true" />}
          />
        );
      case "core:find":
        return (
          <IconButton
            key={id}
            size="toolbar"
            label={t("contentsSearchLabel")}
            aria-pressed={rightShows("search")}
            onClick={toggleContentsSearch}
            className={cn(rightShows("search") && "text-fg")}
            icon={<MagnifyingGlass size={20} weight={rightShows("search") ? "bold" : "regular"} aria-hidden="true" />}
          />
        );
      case "core:appearance":
        return (
          <IconButton
            key={id}
            size="toolbar"
            label={t("readingAppearance")}
            aria-expanded={appearanceOpen}
            aria-controls={drawerId}
            onClick={() => setAppearanceOpen(!appearanceOpen)}
            className={cn(appearanceOpen && "text-fg")}
            icon={<TextAa size={20} weight={appearanceOpen ? "bold" : "regular"} aria-hidden="true" />}
          />
        );
      case "core:chat":
        return (
          <IconButton
            key={id}
            size="toolbar"
            label={t("chat")}
            aria-pressed={rightShows("chat")}
            onClick={toggleNotes}
            className={cn(rightShows("chat") && "text-fg")}
            icon={<ChatCircle size={20} weight={rightShows("chat") ? "bold" : "regular"} aria-hidden="true" />}
          />
        );
      default:
        return null;
    }
  };
  const toolbarSlots = isPhone ? toolbarInline.map(toolbarNode).filter((node) => node !== null) : [];
  // Phones open appearance and notes in the bottom bar's drawer, whether
  // their icon is in the toolbar or in "More". The desktop header needs a
  // dialog for appearance once it is arranged into the overflow menu.
  const appearanceDialog = !isPhone && !readerLayout.visible.includes("core:appearance");
  const drawer: ReaderDrawer | null = isPhone && appearanceOpen ? "appearance" : null;
  const closeDrawer = () => setAppearanceOpen(false);
  const renderDrawer = (): ReaderBottomBarDrawer => ({
    title: t("readingAppearance"),
    body: (
      <div className="min-h-0 overflow-y-auto px-4 pb-5 pt-1">
        <ReaderAppearanceCompact bookId={bookId} fixedLayout={fixedLayout} />
      </div>
    ),
  });

  // Phone sheets close by swipe as well as from the toolbar: the iOS back
  // swipe from the left edge, or a drag toward the side each one leaves by.
  const tocSheetRef = useRef<HTMLElement | null>(null);
  const chatSheetRef = useRef<HTMLElement | null>(null);
  usePanelSwipeDismiss(tocSheetRef, {
    open: sideOpen,
    enabled: isPhone && visible && sideOpen,
    exit: "left",
    onDismiss: closeSide,
  });
  usePanelSwipeDismiss(chatSheetRef, {
    open: notesOpen,
    enabled: isPhone && visible && notesOpen,
    exit: "right",
    onDismiss: () => setNotesOpen(false),
  });
  // A full-screen sheet would hide the jump it just made.
  const closeTocSheetOnPhone = () => {
    if (isPhone) closeSide();
  };
  // A phone sheet ends at the bottom toolbar, which already clears the home
  // indicator, so nothing inside it should pad for that inset again.
  const phoneSheetInsets = isPhone ? ({ "--ra-safe-bottom": "0px" } as CSSProperties) : undefined;

  return (
    // overflow-clip (not -hidden): clips the off-screen panels the same way, but
    // is NOT a scroll container — so focusing/scrolling a panel that's still
    // sliding in can't scroll this box sideways and drift the whole overlay.
    <div className={cn("pointer-events-none fixed inset-0 z-50 flex min-h-0 flex-col overflow-clip")}>
      {appearanceDialog && (
        <Dialog
          open={appearanceOpen}
          onClose={() => setAppearanceOpen(false)}
          title={t("readingAppearance")}
          className="max-h-full overflow-y-auto"
        >
          <ReaderAppearanceFields bookId={bookId} fixedLayout={fixedLayout} />
        </Dialog>
      )}
      {/* Top bar — doubles as the window drag region on desktop. Non-interactive
          children stay pointer-events-none so a drag started anywhere but the
          buttons falls through to this element; the buttons re-enable clicks.
          Left padding clears the macOS traffic lights when present. */}
      <div
        data-tauri-drag-region="deep"
        inert={!visible}
        style={{
          // Left clears the macOS traffic lights (zero on Windows/Linux, where
          // the frameless reader keeps no window controls at all — immersive
          // reading stays chrome-free); the right uses the plain edge inset so
          // the appearance/notes cluster sits flush against the right edge
          // instead of being pushed inward by a mirrored offset. On mobile
          // both sides also clear the display-cutout safe areas, and the bar
          // grows downward past the status bar (content stays a 3rem band).
          paddingLeft: "max(1.25rem, var(--ra-traffic-light-inset), var(--ra-safe-left))",
          paddingRight: "max(1.25rem, var(--ra-safe-right))",
          paddingTop: "var(--ra-safe-top)",
          height: "var(--ra-reader-bar-height)",
        }}
        className={cn(
          // Fixed 3rem content band, matching the main AppHeader. Both bars then
          // center their controls on the same 24px axis, so the single native
          // traffic-light inset (tuned for that band) aligns with both. A taller
          // bar would drop the controls below the lights.
          //
          // z-20 (relative + z-index makes a stacking context) keeps the bar
          // above the docked panels (z-10), so the appearance/stats popovers and
          // button tooltips nested inside it aren't painted under the DOM-later
          // contents/chat panels. Lifting the whole band lifts them too.
          "pointer-events-auto relative z-20 shrink-0 bg-fill transition-all duration-250 ease-out",
          visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none",
        )}
      >
        {/* On phones the progress scrubber takes hold of the whole header
            behind this row; lifting the row keeps its buttons' taps. */}
        <div className={cn("pointer-events-none flex h-full items-center gap-3", isPhone && "relative z-[1]")}>
          {/* Phones keep back to the left of the title and "More" to its
              right; everything else lives in the bottom toolbar. Equal-width
              sides keep the title centered even when "More" has nothing. */}
          {isPhone && (
            <div className="flex w-9 shrink-0 items-center">
              <IconButton
                label={t("backToShelf")}
                onClick={onBack}
                className="pointer-events-auto"
                icon={<CaretLeft size={20} weight="regular" aria-hidden="true" />}
              />
            </div>
          )}

          {/* Left cluster: back to shelf + contents toggle. */}
          {!isPhone && (
            <div className="ml-2 flex shrink-0 items-center gap-0.5">
              <Tooltip content={t("shelf")} side="bottom" className="pointer-events-auto">
                <IconButton
                  size="sm"
                  label={t("backToShelf")}
                  onClick={onBack}
                  icon={<CaretLeft size={18} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
              <Tooltip content={t("contents")} side="bottom" className="pointer-events-auto">
                <IconButton
                  size="sm"
                  label={t("tableOfContents")}
                  aria-pressed={sideShows("contents")}
                  onClick={toggleToc}
                  className={cn(sideShows("contents") && "text-fg")}
                  icon={
                    <ListBullets size={18} weight={sideShows("contents") ? "bold" : "regular"} aria-hidden="true" />
                  }
                />
              </Tooltip>
              <Tooltip content={t("notes")} side="bottom" className="pointer-events-auto">
                <IconButton
                  size="sm"
                  label={t("notes")}
                  aria-pressed={sideShows("notes")}
                  onClick={toggleNotesView}
                  className={cn(sideShows("notes") && "text-fg")}
                  icon={<Notebook size={18} weight={sideShows("notes") ? "bold" : "regular"} aria-hidden="true" />}
                />
              </Tooltip>
            </div>
          )}

          {/* Center: title (prominent) with a small progress readout beneath. */}
          {title && (
            <div className="min-w-0 flex-1 px-2 text-center">
              <Body className="truncate text-[15px] font-semibold leading-tight text-fg">{title}</Body>
              {/* Arbitrary px size: tailwind-merge would strip a custom
                  `text-*` size token when a `text-*` color is also present. */}
              {/* Phones name the chapter there too; the percentage keeps
                  its place when a long chapter name truncates. */}
              {isPhone && currentChapterLabel ? (
                <span className="mt-0.5 flex justify-center gap-1 font-sans text-[11px] leading-none text-fg-subtle">
                  <span className="min-w-0 truncate">{currentChapterLabel}</span>
                  {percent != null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0 tabular-nums">{formatPercent(percent)}</span>
                    </>
                  )}
                </span>
              ) : (
                progressLabel && (
                  <span className="mt-0.5 block truncate font-sans text-[11px] leading-none tabular-nums text-fg-subtle">
                    {progressLabel}
                  </span>
                )
              )}
            </div>
          )}

          {/* Right cluster: user-arranged (navigator/appearance/chat + plugin
              items), remainder behind the vertical-dots overflow. */}
          {isPhone && (
            <div className="flex w-9 shrink-0 items-center justify-end">
              <MenuOverflow entries={toolbarOverflowEntries} className="pointer-events-auto" />
            </div>
          )}
          {!isPhone && (
            <div className="flex shrink-0 items-center justify-end gap-0.5">
              {readerLayout.visible.map((id) => {
                if (id.startsWith("plugin:")) {
                  const action = readerPluginActions.find((entry) => pluginMenuId(entry.key) === id);
                  return action ? (
                    <PluginHeaderItem
                      key={id}
                      action={action}
                      input={{ book: { id: book.id, title: book.title, author: book.author } }}
                      buttonClassName="pointer-events-auto"
                    />
                  ) : null;
                }
                const node = coreReaderNodes[id];
                return node ? (
                  <span key={id} className="contents">
                    {node}
                  </span>
                ) : null;
              })}
              <MenuOverflow entries={readerOverflowEntries} className="pointer-events-auto" />
            </div>
          )}
        </div>

        {/* Reading progress, merged into the header's bottom edge — and the
            scrubber: hover it for a readout, drag it to jump. On phones a
            sideways drag anywhere across the header scrubs. */}
        <ReaderProgressScrubber
          fraction={progress ?? null}
          totalPages={totalPages}
          marks={progressMarks}
          onSeek={onSeek}
          hitArea={isPhone ? "header" : "edge"}
        />
      </div>

      {/* Middle zone -- panels dock to the edges while the reader shows through.
          The panels stay mounted; `visible` only gates whether they are revealed.
          Docked panels keep their open state, so dismissing then re-opening the
          header restores whatever was showing (and avoids a re-fetch flash);
          phone sheets are closed by the hook when the chrome hides. */}
      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 items-stretch justify-between">
        {/* While the bottom bar's drawer is open, a tap on the page closes
            the drawer rather than reaching the book (and toggling the chrome). */}
        {drawer && (
          <div aria-hidden="true" className="pointer-events-auto absolute inset-0 z-[1]" onClick={closeDrawer} />
        )}
        {/* Side panel (left): contents, notes or search */}
        <section
          ref={tocSheetRef}
          aria-label={sideView === "notes" ? t("notes") : t("tableOfContents")}
          inert={!(visible && sideOpen)}
          className={cn(
            "flex min-h-0 flex-col transition-[transform,opacity] duration-200 ease-out",
            isPhone
              ? // Full-screen sheet below the top bar; no divider, no resize.
                "absolute inset-0"
              : "relative h-full shrink-0 border-r border-border-strong/70",
            visible && sideOpen
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "-translate-x-full opacity-0 pointer-events-none",
          )}
          style={{
            width: isPhone ? undefined : sizes.toc,
            backgroundColor: "var(--ra-main-surface-color)",
            ...phoneSheetInsets,
          }}
        >
          <ReaderContentsPanel
            bookId={bookId}
            shown={visible && sideOpen}
            view={sideView}
            notes={{
              annotations,
              loadFailed: annotationsLoadFailed,
              loadErrorCode: annotationsLoadErrorCode,
              isLoading: annotationsLoading,
              onRetryLoad: () => refreshAnnotations(),
              tocEntries,
              onNavigate: (cfiRange) => {
                onAnnotationSelect?.(cfiRange);
                closeTocSheetOnPhone();
              },
              onDelete: removeAnnotationReporting,
              bookmarks: {
                ...bookmarkSection,
                onOpen: (bookmark) => {
                  void bookmarkActions.open(bookmark).then((moved) => {
                    if (moved) closeTocSheetOnPhone();
                  });
                },
              },
            }}
            entries={tocEntries}
            activeIndex={activeTocIndex}
            onChapterSelect={(href) => {
              onChapterSelect?.(href);
              closeTocSheetOnPhone();
            }}
          />
          {!isPhone && (
            <ReaderResizeHandle
              edge="right"
              ariaLabel={t("resizeContents")}
              onResize={(delta) => adjustPanel("toc", delta)}
              onCommit={persistPanelSizes}
            />
          )}
        </section>

        {/* Right panel: the AI conversation, or the book search */}
        <section
          ref={chatSheetRef}
          aria-label={rightView === "search" ? t("contentsSearchLabel") : t("aiChat")}
          // Hidden via transforms (still in the DOM), so without `inert` a focused
          // composer would keep receiving keystrokes off-screen; `inert` also
          // blurs it and drops the panel out of the tab order while closed.
          inert={!(visible && notesOpen)}
          className={cn(
            "flex min-h-0 flex-col transition-[transform,opacity] duration-200 ease-out",
            isPhone ? "absolute inset-0" : "relative h-full shrink-0 border-l border-border-strong/70",
            visible && notesOpen
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "translate-x-full opacity-0 pointer-events-none",
          )}
          style={{
            width: isPhone ? undefined : sizes.chat,
            backgroundColor: "var(--ra-main-surface-color)",
            ...phoneSheetInsets,
          }}
        >
          {!isPhone && (
            <ReaderResizeHandle
              edge="left"
              ariaLabel={t("resizeChat")}
              onResize={(delta) => adjustPanel("chat", -delta)}
              onCommit={persistPanelSizes}
            />
          )}
          {/* The conversation stays mounted under the search, so a draft or a
              streaming reply survives a look at the search. */}
          <div className={cn("flex min-h-0 flex-1 flex-col", rightView === "search" && "hidden")}>
            <ChatPanel
              bookId={bookId}
              bookTitle={title}
              focusRequestId={chatFocusRequestId}
              focusOrigin={chatFocusOrigin}
              readingCursor={readingCursor}
              revealed={visible && rightShows("chat")}
            />
          </div>
          {rightView === "search" && (
            <ReaderSearchPanel
              bookId={bookId}
              shown={visible && rightShows("search")}
              entries={tocEntries}
              annotations={annotations}
              bookmarks={bookmarks ?? []}
              onClose={() => setNotesOpen(false)}
              onChapterSelect={onChapterSelect}
              onAnnotationSelect={onAnnotationSelect}
              onBookmarkSelect={bookmarkActions.open}
              onJumped={() => {
                // A full-screen sheet would hide the jump it just made.
                if (isPhone) setNotesOpen(false);
              }}
            />
          )}
        </section>
      </div>

      {isPhone && (
        <ReaderBottomBar
          visible={visible}
          drawerId={drawerId}
          drawer={drawer}
          renderDrawer={renderDrawer}
          onCloseDrawer={closeDrawer}
          slotRowRef={toolbarRowRef}
          slots={toolbarSlots}
        />
      )}
    </div>
  );
}
