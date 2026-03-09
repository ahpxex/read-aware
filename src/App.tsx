import { useAtom } from "jotai";
import { activeTopNavAtom, topNavs } from "./state/ui";

const sectionCopy = {
  shelf: {
    eyebrow: "Shelf",
    title: "A shelf that reads with the restraint of a printed page.",
    body:
      "The layout stays quiet so the collection can breathe. Titles, sequence, and open margins do the work without decorative chrome competing for attention.",
    notes: [
      {
        label: "Rhythm",
        value: "Wide spacing and a single left edge make the reading list easy to scan.",
      },
      {
        label: "Surface",
        value: "A paper-toned canvas replaces cards, glow, and extra containers.",
      },
      {
        label: "Signal",
        value: "Typography carries hierarchy so the interface can stay visually spare.",
      },
    ],
  },
  context: {
    eyebrow: "Context",
    title: "Context stays nearby, but never louder than the text itself.",
    body:
      "Supporting material sits in a calm, editorial frame. The emphasis stays on comprehension, with just enough structure to orient the reader when they need it.",
    notes: [
      {
        label: "Placement",
        value: "Contextual details sit in sequence instead of competing side panels.",
      },
      {
        label: "Tone",
        value: "The palette remains monochrome and warm, without gradients or accent glare.",
      },
      {
        label: "Focus",
        value: "Each block is shortened to the essentials so interpretation feels effortless.",
      },
    ],
  },
  settings: {
    eyebrow: "Settings",
    title: "Settings recede until they are needed.",
    body:
      "Preferences are presented as quiet editorial controls rather than a dashboard. The result feels deliberate, lightweight, and appropriately secondary to reading.",
    notes: [
      {
        label: "Priority",
        value: "Controls are demoted visually so content keeps the first and last word.",
      },
      {
        label: "Language",
        value: "Short labels and direct copy keep the interface clear without extra explanation.",
      },
      {
        label: "Restraint",
        value: "No badges, gradients, or ornamental highlights distract from the core tasks.",
      },
    ],
  },
} satisfies Record<
  (typeof topNavs)[number],
  {
    eyebrow: string;
    title: string;
    body: string;
    notes: Array<{
      label: string;
      value: string;
    }>;
  }
>;

function App() {
  const [activeTopNav, setActiveTopNav] = useAtom(activeTopNavAtom);
  const activeSection = sectionCopy[activeTopNav];

  return (
    <main className="min-h-screen bg-stone-100 text-stone-950">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14">
        <header className="border-b border-stone-900/10 pb-4">
          <nav aria-label="Primary" className="flex flex-wrap gap-6 sm:gap-8">
            {topNavs.map((item) => {
              const isActive = item === activeTopNav;

              return (
                <button
                  key={item}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setActiveTopNav(item)}
                  className={
                    isActive
                      ? "bg-transparent p-0 text-[11px] font-medium uppercase tracking-[0.28em] text-stone-950"
                      : "bg-transparent p-0 text-[11px] font-medium uppercase tracking-[0.28em] text-stone-500 transition-colors hover:text-stone-950"
                  }
                >
                  {item}
                </button>
              );
            })}
          </nav>
        </header>

        <article className="flex flex-1 flex-col justify-center py-16 sm:py-20 lg:py-24">
          <p className="text-[11px] uppercase tracking-[0.28em] text-stone-500">
            {activeSection.eyebrow}
          </p>
          <h1 className="mt-6 max-w-4xl font-serif text-5xl leading-[0.98] tracking-tight text-stone-950 sm:text-6xl lg:text-7xl">
            {activeSection.title}
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-8 text-stone-700 sm:text-lg">
            {activeSection.body}
          </p>

          <dl className="mt-16 grid gap-8 border-t border-stone-900/10 pt-8 sm:grid-cols-3 sm:gap-10">
            {activeSection.notes.map((note) => (
              <div key={note.label}>
                <dt className="text-[11px] font-medium uppercase tracking-[0.28em] text-stone-500">
                  {note.label}
                </dt>
                <dd className="mt-3 text-sm leading-7 text-stone-800">{note.value}</dd>
              </div>
            ))}
          </dl>
        </article>
      </div>
    </main>
  );
}

export default App;
