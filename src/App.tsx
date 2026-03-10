import { type MouseEvent } from "react";
import { useAtom } from "jotai";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { activeTopNavAtom, settingsOpenAtom, topNavs } from "./state/ui";
import {
  Display,
  Body,
  Eyebrow,
  NavItem,
  Divider,
  DefinitionList,
  Button,
} from "./components";
import { SettingsView } from "./features/settings/SettingsView";
import { Shelf } from "./features/shelf/components/Shelf";
import type { Book } from "./features/shelf/components/BookCover";

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

const shelfSections = [
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

  if (settingsOpen) {
    return <SettingsView onBack={() => setSettingsOpen(false)} />;
  }

  return (
    <main className="flex h-screen flex-col bg-stone-100 text-stone-950">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="shrink-0 border-b border-border bg-stone-100"
        onMouseDown={(e: MouseEvent<HTMLElement>) => {
          const tag = (e.target as HTMLElement).closest("button, a, input");
          if (e.buttons === 1 && !tag) {
            e.detail === 2
              ? getCurrentWindow().toggleMaximize()
              : getCurrentWindow().startDragging();
          }
        }}
      >
        <div className="flex select-none items-center justify-center py-1 text-[10px] font-medium tracking-eyebrow text-stone-400">
          ReadAware
        </div>
        <header className="px-6 pt-3 pb-3 sm:px-10 sm:pt-4 sm:pb-4 lg:px-14">
          <nav
            aria-label="Primary"
            className="mx-auto flex max-w-5xl items-center gap-6 sm:gap-8"
          >
            {topNavs.map((item) => (
              <NavItem
                key={item}
                active={item === activeTopNav}
                onClick={() => setActiveTopNav(item)}
              >
                {item}
              </NavItem>
            ))}

            <div className="ml-auto flex items-center gap-4">
              <Button variant="ghost" size="sm">Import</Button>
              <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>Settings</Button>
            </div>
          </nav>
        </header>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTopNav === "shelf" ? (
          <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-10 lg:px-14">
            <Shelf sections={shelfSections} />
          </div>
        ) : (
          <article className="mx-auto flex min-h-full max-w-5xl flex-col justify-center px-6 py-16 sm:px-10 sm:py-20 lg:px-14 lg:py-24">
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
      </div>
    </main>
  );
}

export default App;
