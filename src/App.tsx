import { useState } from "react";
import { useAtom } from "jotai";
import { settingsOpenAtom } from "./state/ui";
import { Body, Button, Dialog } from "./components";
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

function App() {
  const [settingsOpen, setSettingsOpen] = useAtom(settingsOpenAtom);
  const [askOpen, setAskOpen] = useState(false);

  if (settingsOpen) {
    return <SettingsView onBack={() => setSettingsOpen(false)} />;
  }

  return (
    <main className="flex h-screen flex-col bg-stone-100 text-stone-950">
      <header className="shrink-0 border-b border-border bg-stone-100 px-6 py-3 sm:px-10 sm:py-4 lg:px-14">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 sm:gap-8">
          <button
            type="button"
            onClick={() => setAskOpen(true)}
            className="flex w-full max-w-lg items-center gap-2 rounded-md border border-border bg-transparent px-3 py-2 text-base text-stone-400 transition-colors hover:border-stone-950"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <span>Ask anything...</span>
          </button>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm">Import</Button>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>Settings</Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-10 lg:px-14">
          <Shelf sections={shelfSections} />
        </div>
      </div>

      <Dialog open={askOpen} onClose={() => setAskOpen(false)} title="Ask anything">
        <Body>This feature is coming soon.</Body>
      </Dialog>
    </main>
  );
}

export default App;
