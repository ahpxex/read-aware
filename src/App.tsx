import { useAtom } from "jotai";
import { activeTopNavAtom, topNavs } from "./state/ui";
import {
  Display,
  Body,
  Eyebrow,
  NavItem,
  Divider,
  DefinitionList,
} from "./components";

const sectionCopy = {
  shelf: {
    eyebrow: "Shelf",
    title: "A shelf that reads with the restraint of a printed page.",
    body: "The layout stays quiet so the collection can breathe. Titles, sequence, and open margins do the work without decorative chrome competing for attention.",
    notes: [
      {
        label: "Rhythm",
        value:
          "Wide spacing and a single left edge make the reading list easy to scan.",
      },
      {
        label: "Surface",
        value:
          "A paper-toned canvas replaces cards, glow, and extra containers.",
      },
      {
        label: "Signal",
        value:
          "Typography carries hierarchy so the interface can stay visually spare.",
      },
    ],
  },
  context: {
    eyebrow: "Context",
    title: "Context stays nearby, but never louder than the text itself.",
    body: "Supporting material sits in a calm, editorial frame. The emphasis stays on comprehension, with just enough structure to orient the reader when they need it.",
    notes: [
      {
        label: "Placement",
        value:
          "Contextual details sit in sequence instead of competing side panels.",
      },
      {
        label: "Tone",
        value:
          "The palette remains monochrome and warm, without gradients or accent glare.",
      },
      {
        label: "Focus",
        value:
          "Each block is shortened to the essentials so interpretation feels effortless.",
      },
    ],
  },
  settings: {
    eyebrow: "Settings",
    title: "Settings recede until they are needed.",
    body: "Preferences are presented as quiet editorial controls rather than a dashboard. The result feels deliberate, lightweight, and appropriately secondary to reading.",
    notes: [
      {
        label: "Priority",
        value:
          "Controls are demoted visually so content keeps the first and last word.",
      },
      {
        label: "Language",
        value:
          "Short labels and direct copy keep the interface clear without extra explanation.",
      },
      {
        label: "Restraint",
        value:
          "No badges, gradients, or ornamental highlights distract from the core tasks.",
      },
    ],
  },
} satisfies Record<
  (typeof topNavs)[number],
  {
    eyebrow: string;
    title: string;
    body: string;
    notes: Array<{ label: string; value: string }>;
  }
>;

function App() {
  const [activeTopNav, setActiveTopNav] = useAtom(activeTopNavAtom);
  const activeSection = sectionCopy[activeTopNav];

  return (
    <main className="min-h-screen bg-stone-100 text-stone-950">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14">
        <header className="border-b border-border pb-4">
          <nav aria-label="Primary" className="flex flex-wrap gap-6 sm:gap-8">
            {topNavs.map((item) => (
              <NavItem
                key={item}
                active={item === activeTopNav}
                onClick={() => setActiveTopNav(item)}
              >
                {item}
              </NavItem>
            ))}
          </nav>
        </header>

        <article className="flex flex-1 flex-col justify-center py-16 sm:py-20 lg:py-24">
          <Eyebrow>{activeSection.eyebrow}</Eyebrow>
          <Display as="h1" size="7xl" className="mt-6 max-w-4xl">
            {activeSection.title}
          </Display>
          <Body size="lg" className="mt-8 max-w-2xl">
            {activeSection.body}
          </Body>

          <Divider className="mt-16" />
          <DefinitionList
            items={activeSection.notes}
            columns={3}
            className="pt-8"
          />
        </article>
      </div>
    </main>
  );
}

export default App;
