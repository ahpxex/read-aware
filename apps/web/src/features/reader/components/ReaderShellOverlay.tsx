import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { CaretLeft, ChatCircle, ListBullets, Rows } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { usePhoneViewport } from "@read-aware/ui/media";
import { Body, IconButton, ScrollArea, Tooltip } from "@read-aware/ui";
import { formatPercent, useTranslation } from "../../../i18n";
import { ChatPanel } from "../../ai/components/ChatPanel";
import { askAiRequestAtom } from "../../ai/state/chat-intent";
import { useBookAnnotations } from "../../annotations/hooks/useBookAnnotations";
import type { LibraryBook } from "../../library/lib/library-types";
import { useBackInterceptor } from "../../../hooks/useBackInterceptor";
import { MenuOverflow, type MenuOverflowEntry } from "../../menus/components/MenuOverflow";
import { coreMenuMeta } from "../../menus/lib/menu-registry";
import {
  CORE_MENU_DEFAULTS,
  menuConfigAtom,
  pluginMenuId,
  resolveSurfaceLayout,
} from "../../menus/state/menu-config";
import { PluginHeaderItem } from "../../plugins/components/PluginHeaderCluster";
import { openHeaderActionDialog } from "../../plugins/lib/open-header-action";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import { headerActionsAtom } from "../../plugins/state/plugin-store";
import { findTocIndexForHref } from "../lib/epub-utils";
import { useReaderPanelLayout } from "../hooks/useReaderPanelLayout";
import { useReaderPanelSizes } from "../hooks/useReaderPanelSizes";
import type { TocEntry } from "../lib/reader-types";
import { ReaderNotesPopover } from "./ReaderNotesPopover";
import { ReaderResizeHandle } from "./ReaderResizeHandle";
import { ReaderAppearanceMenu } from "./ReaderAppearanceMenu";

type ReaderShellOverlayProps = {
  visible: boolean;
  onBack: () => void;
  book: LibraryBook;
  progress?: number;
  currentPage?: number;
  totalPages?: number;
  tocEntries?: TocEntry[];
  currentChapterHref?: string | null;
  onChapterSelect?: (href: string) => void;
  onAnnotationSelect?: (cfiRange: string) => void;
  /** Sentence navigator toggle. Unavailable for fixed-layout books. */
  navigatorInstalled?: boolean;
  navigatorAvailable?: boolean;
  navigatorActive?: boolean;
  onToggleNavigator?: () => void;
};

export function ReaderShellOverlay({
  visible,
  onBack,
  book,
  progress,
  currentPage,
  totalPages,
  tocEntries = [],
  currentChapterHref = null,
  onChapterSelect,
  onAnnotationSelect,
  navigatorInstalled = true,
  navigatorAvailable = true,
  navigatorActive = false,
  onToggleNavigator,
}: ReaderShellOverlayProps) {
  const { t } = useTranslation("reader");
  const bookId = book.id;
  const title = book.title;
  const percent =
    progress != null ? Math.min(100, Math.max(0, progress * 100)) : null;
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

  // TOC + chat panels persist per book (restored when the book reopens); the
  // appearance popover is transient and resets each session.
  const { tocOpen, notesOpen, setTocOpen, setNotesOpen } = useReaderPanelLayout(bookId);
  const { sizes, adjust: adjustPanel, persist: persistPanelSizes } = useReaderPanelSizes();
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  // Phone-width: the side docks become full-screen sheets (below the top bar),
  // so only one can be open at a time and resizing is meaningless.
  const isPhone = usePhoneViewport();
  const toggleToc = () => {
    const next = !tocOpen;
    setTocOpen(next);
    if (next && isPhone) setNotesOpen(false);
  };
  const toggleNotes = () => {
    const next = !notesOpen;
    setNotesOpen(next);
    if (next && isPhone) setTocOpen(false);
  };

  // Android back gesture: a phone full-screen sheet is a deeper layer, so back
  // closes it (chat first — it renders on top) instead of unwinding the whole
  // reader back to the shelf. Docked desktop/tablet panels don't occlude the
  // page, so there back keeps its usual close-the-book meaning.
  useBackInterceptor(() => {
    if (!visible || !isPhone) return false;
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
  // Kept live as marks are made via the shared revision in useBookAnnotations.
  const { annotations, remove: removeAnnotation } = useBookAnnotations(bookId);

  // User-arranged right cluster (settings → Menus).
  const { t: tMenus } = useTranslation("settings");
  const menuConfig = useAtomValue(menuConfigAtom);
  const readerPluginActions = useAtomValue(headerActionsAtom).filter(
    (action) => action.surface === "reader",
  );
  const readerCoreItems = CORE_MENU_DEFAULTS.readerHeader.filter(
    (id) => id !== "core:navigator" || navigatorInstalled,
  );
  const readerLayout = resolveSurfaceLayout(menuConfig.readerHeader, [
    ...readerCoreItems,
    ...readerPluginActions.map((action) => pluginMenuId(action.key)),
  ]);

  const coreReaderNodes: Record<string, React.ReactNode | null> = {
    "core:navigator": navigatorAvailable ? (
      <Tooltip content={t("navigator.title")} side="bottom" className="pointer-events-auto">
        <IconButton
          size="sm"
          label={navigatorActive ? t("navigator.exit") : t("navigator.enable")}
          aria-pressed={navigatorActive}
          onClick={onToggleNavigator}
          className={cn(navigatorActive && "text-fg")}
          icon={
            <Rows size={18} weight={navigatorActive ? "bold" : "regular"} aria-hidden="true" />
          }
        />
      </Tooltip>
    ) : null,
    "core:appearance": (
      <ReaderAppearanceMenu
        bookId={bookId}
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
      />
    ),
    "core:chat": (
      <Tooltip content={t("chat")} side="bottom" className="pointer-events-auto">
        <IconButton
          size="sm"
          label={t("chat")}
          aria-pressed={notesOpen}
          onClick={toggleNotes}
          className={cn(notesOpen && "text-fg")}
          icon={
            <ChatCircle size={18} weight={notesOpen ? "bold" : "regular"} aria-hidden="true" />
          }
        />
      </Tooltip>
    ),
  };

  const coreReaderRun: Record<string, (() => void) | undefined> = {
    "core:navigator": navigatorAvailable ? onToggleNavigator : undefined,
    "core:chat": toggleNotes,
  };
  const readerOverflowEntries = readerLayout.overflow
    .map((id): MenuOverflowEntry | null => {
      if (id.startsWith("plugin:")) {
        const action = readerPluginActions.find((entry) => pluginMenuId(entry.key) === id);
        if (!action) return null;
        return {
          id,
          label: action.title,
          icon: renderPluginIcon(action.icon, 16),
          run: () =>
            void openHeaderActionDialog(action, {
              book: { id: book.id, title: book.title, author: book.author },
            }),
        };
      }
      const meta = coreMenuMeta("readerHeader", id);
      if (!meta) return null;
      if (id === "core:appearance") {
        return {
          id,
          label: String(tMenus(`menus.items.${meta.labelKey}` as never)),
          icon: <meta.Icon size={16} weight="regular" aria-hidden="true" />,
          node: coreReaderNodes["core:appearance"],
        };
      }
      const run = coreReaderRun[id];
      if (!run) return null;
      return {
        id,
        label: String(tMenus(`menus.items.${meta.labelKey}` as never)),
        icon: <meta.Icon size={16} weight="regular" aria-hidden="true" />,
        run,
      };
    })
    .filter((entry): entry is MenuOverflowEntry => entry !== null);

  const activeTocIndex = findTocIndexForHref(tocEntries, currentChapterHref);

  // "Ask AI about this" fires from the reader (a sibling component) via this
  // atom. Reveal the chat panel; the chat panel itself adopts the passage. We
  // track the handled id rather than clearing the atom so the panel can react to
  // the same dispatch independently.
  const askAiRequest = useAtomValue(askAiRequestAtom);
  const handledAskAiIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!askAiRequest || askAiRequest.bookId !== bookId) return;
    if (askAiRequest.id === handledAskAiIdRef.current) return;
    handledAskAiIdRef.current = askAiRequest.id;
    setNotesOpen(true);
    // Full-screen sheets are exclusive on phones — chat replaces the TOC.
    if (isPhone) setTocOpen(false);
  }, [askAiRequest, bookId, setNotesOpen, setTocOpen, isPhone]);

  // The appearance popover is transient — it closes whenever the overlay is
  // dismissed. The contents and chat panels are NOT reset: they keep their open
  // state so dismissing then re-opening the header restores whatever the reader
  // had revealed. (Reset state lives in the panels' `visible &&` reveal gate.)
  useEffect(() => {
    if (!visible) {
      setAppearanceOpen(false);
    }
  }, [visible]);

  // Reveal the current chapter when the contents panel opens (or the chapter
  // changes while it's open), centering it so it's easy to find.
  const tocListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!visible || !tocOpen) return;
    const frame = window.requestAnimationFrame(() => {
      tocListRef.current
        ?.querySelector('[aria-current="location"]')
        ?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible, tocOpen, currentChapterHref]);

  return (
    // overflow-clip (not -hidden): clips the off-screen panels the same way, but
    // is NOT a scroll container — so focusing/scrolling a panel that's still
    // sliding in can't scroll this box sideways and drift the whole overlay.
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-50 flex min-h-0 flex-col overflow-clip",
      )}
    >
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
          height: "calc(3rem + var(--ra-safe-top))",
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
          visible
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="pointer-events-none flex h-full items-center gap-3">
          {/* Left cluster: back to shelf + contents toggle */}
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
                aria-pressed={tocOpen}
                onClick={toggleToc}
                className={cn(tocOpen && "text-fg")}
                icon={
                  <ListBullets
                    size={18}
                    weight={tocOpen ? "bold" : "regular"}
                    aria-hidden="true"
                  />
                }
              />
            </Tooltip>
            <ReaderNotesPopover
              annotations={annotations}
              tocEntries={tocEntries}
              onNavigate={(cfiRange) => onAnnotationSelect?.(cfiRange)}
              onDelete={(id) => void removeAnnotation(id)}
            />
          </div>

          {/* Center: title (prominent) with a small progress readout beneath. */}
          {title && (
            <div className="min-w-0 flex-1 px-2 text-center">
              <Body className="truncate text-[15px] font-semibold leading-tight text-fg">
                {title}
              </Body>
              {/* Arbitrary px size: tailwind-merge would strip a custom
                  `text-*` size token when a `text-*` color is also present. */}
              {progressLabel && (
                <span className="mt-0.5 block truncate font-sans text-[11px] leading-none tabular-nums text-fg-subtle">
                  {progressLabel}
                </span>
              )}
            </div>
          )}

          {/* Right cluster: user-arranged (navigator/appearance/chat + plugin
              items), remainder behind the vertical-dots overflow. */}
          <div className="flex shrink-0 items-center justify-end gap-0.5">
            {readerLayout.visible.map((id) => {
              if (id.startsWith("plugin:")) {
                const action = readerPluginActions.find(
                  (entry) => pluginMenuId(entry.key) === id,
                );
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
              return node ? <span key={id} className="contents">{node}</span> : null;
            })}
            <MenuOverflow
              entries={readerOverflowEntries}
              className="pointer-events-auto"
            />
          </div>
        </div>

        {/* Reading progress, merged into the header's bottom edge. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-border/70">
          {percent != null && (
            <div
              className="h-full bg-fg-subtle transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          )}
        </div>
      </div>

      {/* Middle zone -- panels dock to the edges while the reader shows through.
          The panels stay mounted and preserve their open state; `visible` only
          gates whether they are revealed, so dismissing then re-opening the
          header restores whatever was showing (and avoids a re-fetch flash). */}
      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 items-stretch justify-between">
        {/* Table of contents (left) */}
        <section
          aria-label={t("tableOfContents")}
          inert={!(visible && tocOpen)}
          className={cn(
            "flex min-h-0 flex-col transition-[transform,opacity] duration-200 ease-out",
            isPhone
              ? // Full-screen sheet below the top bar; no divider, no resize.
                "absolute inset-0"
              : "relative h-full shrink-0 border-r border-border-strong/70",
            visible && tocOpen
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "-translate-x-full opacity-0 pointer-events-none",
          )}
          style={{
            width: isPhone ? undefined : sizes.toc,
            backgroundColor: "var(--ra-main-surface-color)",
          }}
        >
          <ScrollArea className="h-full min-h-0 flex-1">
            <div
              ref={tocListRef}
              className="flex flex-col px-3 py-4 pb-[calc(1rem+var(--ra-safe-bottom))]"
            >
              {tocEntries.length === 0 && (
                <Body className="px-2 py-2 text-sm text-fg-muted">
                  {t("noToc")}
                </Body>
              )}

              {tocEntries.map((entry, index) => {
                // A single resolved index (fragment-aware) — per-entry loose
                // matching lit up every chapter sharing the current spine file.
                const isActive = index === activeTocIndex;

                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      onChapterSelect?.(entry.href);
                      // A full-screen sheet would hide the jump it just made.
                      if (isPhone) setTocOpen(false);
                    }}
                    aria-current={isActive ? "location" : undefined}
                    className={cn(
                      "w-full border-l-2 py-1.5 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                      isActive
                        ? "border-fg bg-fill text-fg"
                        : "border-transparent text-fg-muted hover:text-fg",
                    )}
                    style={{ paddingLeft: `${1 + entry.depth * 0.85}rem` }}
                  >
                    <Body
                      as="span"
                      className={cn(
                        "block min-w-0 text-sm leading-6",
                        isActive ? "font-semibold text-fg" : "text-inherit",
                      )}
                    >
                      {entry.label}
                    </Body>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
          {!isPhone && (
            <ReaderResizeHandle
              edge="right"
              ariaLabel={t("resizeContents")}
              onResize={(delta) => adjustPanel("toc", delta)}
              onCommit={persistPanelSizes}
            />
          )}
        </section>

        {/* AI conversation (right) */}
        <section
          aria-label={t("aiChat")}
          // Hidden via transforms (still in the DOM), so without `inert` a focused
          // composer would keep receiving keystrokes off-screen; `inert` also
          // blurs it and drops the panel out of the tab order while closed.
          inert={!(visible && notesOpen)}
          className={cn(
            "flex min-h-0 flex-col transition-[transform,opacity] duration-200 ease-out",
            isPhone
              ? "absolute inset-0"
              : "relative h-full shrink-0 border-l border-border-strong/70",
            visible && notesOpen
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "translate-x-full opacity-0 pointer-events-none",
          )}
          style={{
            width: isPhone ? undefined : sizes.chat,
            backgroundColor: "var(--ra-main-surface-color)",
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
          <ChatPanel
            bookId={bookId}
            bookTitle={title}
            active={visible && notesOpen}
            chapterHref={currentChapterHref}
          />
        </section>
      </div>
    </div>
  );
}
