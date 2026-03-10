import { useAtom } from "jotai";
import { settingsOpenAtom } from "./state/ui";
import { Avatar, TextField } from "./components";
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

  if (settingsOpen) {
    return <SettingsView onBack={() => setSettingsOpen(false)} />;
  }

  return (
    <main className="flex h-screen flex-col bg-stone-100 text-stone-950">
      <header className="shrink-0 border-b border-border bg-stone-100 px-6 pt-6 pb-4 sm:px-10 sm:pt-8 lg:px-14">
        <div className="mx-auto flex max-w-5xl items-center gap-6 sm:gap-8">
          <div className="ml-auto max-w-64">
            <TextField
              label=""
              aria-label="Search shelf"
              variant="outlined"
              placeholder="Search shelf..."
              leadingIcon={
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
              }
            />
          </div>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="-mr-2 flex items-center gap-2 rounded-full py-1 pl-3 pr-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-950"
          >
            <span>Jane Doe</span>
            <Avatar initials="JD" alt="Jane Doe" size="xs" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-10 lg:px-14">
          <Shelf sections={shelfSections} />
        </div>
      </div>
    </main>
  );
}

export default App;
