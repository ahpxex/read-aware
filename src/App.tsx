import { type MouseEvent, useCallback } from "react";
import { useAtom } from "jotai";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GearSix, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { useLocalAtom } from "./state/local";
import { activeTopNavAtom, settingsOpenAtom, topNavs } from "./state/ui";
import {
  Display,
  Body,
  Eyebrow,
  NavItem,
  Divider,
  DefinitionList,
  IconButton,
  ScrollArea,
  Tooltip,
} from "./components";
import { SettingsView } from "./features/settings/SettingsView";
import { Shelf } from "./features/shelf/components/Shelf";
import type { Book } from "./features/shelf/components/BookCover";
import { EpubReaderView } from "./features/reader/components/EpubReaderView";
import { ReaderShellOverlay } from "./features/reader/components/ReaderShellOverlay";
import demoEpubUrl from "../demo/ElonMusk.epub?url";

const currentlyReading: Book[] = [
  { id: "1", title: "The Master and Margarita", author: "Mikhail Bulgakov", progress: 64 },
  { id: "2", title: "Thinking, Fast and Slow", author: "Daniel Kahneman", progress: 23 },
];

const upNext: Book[] = [
  { id: "3", title: "Austerlitz", author: "W. G. Sebald" },
  { id: "4", title: "The Structure of Scientific Revolutions", author: "Thomas S. Kuhn" },
  { id: "5", title: "Invisible Cities", author: "Italo Calvino" },
  { id: "6", title: "The Periodic Table", author: "Primo Levi" },
  { id: "7", title: "Pale Fire", author: "Vladimir Nabokov" },
];

const finished: Book[] = [
  { id: "8", title: "Blindness", author: "Jose Saramago", progress: 100 },
  { id: "9", title: "If on a Winter's Night a Traveler", author: "Italo Calvino", progress: 100 },
  { id: "10", title: "The Plague", author: "Albert Camus", progress: 100 },
];

const initialShelfSections = [
  { label: "Currently Reading", books: currentlyReading },
  { label: "Up Next", books: upNext },
  { label: "Finished", books: finished },
];

const contextCopy = {
  eyebrow: "Context",
  title: "Context stays nearby, but never louder than the text itself.",
  body: "Supporting material sits in a calm, editorial frame. The emphasis stays on comprehension, with just enough structure to orient the reader when they need it.",
  notes: [
    { label: "Placement", value: "Contextual details sit in sequence instead of competing side panels." },
    { label: "Tone", value: "The palette remains monochrome and warm, without gradients or accent glare." },
    { label: "Focus", value: "Each block is shortened to the essentials so interpretation feels effortless." },
  ],
};

function App() {
  const [activeTopNav, setActiveTopNav] = useAtom(activeTopNavAtom);
  const [settingsOpen, setSettingsOpen] = useAtom(settingsOpenAtom);
  const [shelfSections, setShelfSections] = useLocalAtom(initialShelfSections);
  const [selectedShelfBook, setSelectedShelfBook] = useLocalAtom<Book | null>(null);
  const [shellVisible, setShellVisible] = useLocalAtom(false);
  const [readerPage, setReaderPage] = useLocalAtom({ current: 0, total: 0 });
  const headerIconButtonClass =
    "relative text-stone-500 hover:text-stone-950 before:absolute before:-inset-1 before:content-['']";

  const toggleShell = useCallback(() => setShellVisible((v) => !v), [setShellVisible]);
  const hideShell = useCallback(() => setShellVisible(false), [setShellVisible]);
  const handlePageChange = useCallback((current: number, total: number) => {
    setReaderPage({ current, total });
    if (!selectedShelfBook || total <= 0) return;

    const nextProgress = Math.round((current / total) * 100);
    setShelfSections((sections) =>
      sections.map((section) => ({
        ...section,
        books: section.books.map((book) =>
          book.id === selectedShelfBook.id
            ? { ...book, progress: nextProgress }
            : book,
        ),
      })),
    );
  }, [selectedShelfBook, setReaderPage, setShelfSections]);

  const openReader = useCallback((book: Book) => {
    setSelectedShelfBook(book);
    setReaderPage({ current: 0, total: 0 });
  }, [setReaderPage, setSelectedShelfBook]);

  const closeReader = useCallback(() => {
    setSelectedShelfBook(null);
    setShellVisible(false);
  }, [setSelectedShelfBook, setShellVisible]);

  if (selectedShelfBook) {
    return (
      <div className="relative h-screen w-full">
        <EpubReaderView
          selectedBook={selectedShelfBook}
          initialEpubUrl={demoEpubUrl}
          onContentClick={toggleShell}
          onContentScroll={hideShell}
          onPageChange={handlePageChange}
        />
        <ReaderShellOverlay
          visible={shellVisible}
          onBack={closeReader}
          title={selectedShelfBook.title}
          subtitle={selectedShelfBook.author}
          progress={readerPage.total > 0 ? readerPage.current / readerPage.total : undefined}
          currentPosition={readerPage.total > 0 ? `Page ${readerPage.current} of ${readerPage.total}` : undefined}
        />
      </div>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-[var(--ra-main-surface-color)] text-stone-950">
      <div
        className="shrink-0 border-b border-border bg-[var(--ra-main-surface-color)]"
        onMouseDown={(e: MouseEvent<HTMLElement>) => {
          const tag = (e.target as HTMLElement).closest("button, a, input");
          if (e.buttons === 1 && !tag) {
            try {
              e.detail === 2
                ? getCurrentWindow().toggleMaximize()
                : getCurrentWindow().startDragging();
            } catch {
              // No Tauri runtime
            }
          }
        }}
      >
        <div className="flex select-none items-center justify-center py-1 text-[10px] font-medium tracking-eyebrow text-stone-400">
          ReadAware
        </div>
        <header className="pt-3 pb-3 sm:pt-4 sm:pb-4">
          <nav
            aria-label="Primary"
            className="mx-auto flex max-w-screen-2xl items-center gap-6 px-6 sm:gap-8"
          >
            {topNavs.map((item) => (
              <NavItem
                key={item}
                active={item === activeTopNav}
                onClick={() => {
                  setActiveTopNav(item);
                }}
              >
                {item}
              </NavItem>
            ))}

            <div className="ml-auto flex items-center gap-4">
              <Tooltip content="Search">
                <IconButton
                  label="Search"
                  size="sm"
                  className={headerIconButtonClass}
                  icon={<MagnifyingGlass size={14} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
              <Tooltip content="Import">
                <IconButton
                  label="Import"
                  size="sm"
                  className={headerIconButtonClass}
                  icon={<Plus size={14} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
              <Tooltip content="Settings">
                <IconButton
                  label="Settings"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  className={headerIconButtonClass}
                  icon={<GearSix size={14} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
            </div>
          </nav>
        </header>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {activeTopNav === "shelf" ? (
          <div className="mx-auto max-w-screen-2xl px-6 py-8 sm:py-10">
            <Shelf
              sections={shelfSections}
              onSelect={openReader}
            />
          </div>
        ) : (
          <article className="mx-auto flex min-h-full max-w-screen-2xl flex-col justify-center px-6 py-16 sm:py-20 lg:py-24">
            <Eyebrow>{contextCopy.eyebrow}</Eyebrow>
            <Display as="h1" size="7xl" className="mt-6 max-w-4xl">
              {contextCopy.title}
            </Display>
            <Body size="lg" className="mt-8 max-w-2xl">
              {contextCopy.body}
            </Body>

            <Divider className="mt-16" />
            <DefinitionList
              items={contextCopy.notes}
              columns={3}
              className="pt-8"
            />
          </article>
        )}
      </ScrollArea>

      {settingsOpen && (
        <SettingsView onClose={() => setSettingsOpen(false)} />
      )}
    </main>
  );
}

export default App;
