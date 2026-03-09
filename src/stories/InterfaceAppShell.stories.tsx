import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  NavItem,
  Display,
  Eyebrow,
  Body,
  Divider,
  DefinitionList,
  Kbd,
  Caption,
  Stack,
  Avatar,
} from "../components";
import { SettingsView } from "../features/settings/SettingsView";

const navItems = ["shelf", "context"] as const;

const sectionContent: Record<
  (typeof navItems)[number],
  { eyebrow: string; title: string; body: string; notes: { label: string; value: string }[] }
> = {
  shelf: {
    eyebrow: "Shelf",
    title: "A shelf that reads with the restraint of a printed page.",
    body: "The layout stays quiet so the collection can breathe. Titles, sequence, and open margins do the work without decorative chrome competing for attention.",
    notes: [
      { label: "Rhythm", value: "Wide spacing and a single left edge make the reading list easy to scan." },
      { label: "Surface", value: "A paper-toned canvas replaces cards, glow, and extra containers." },
      { label: "Signal", value: "Typography carries hierarchy so the interface can stay visually spare." },
    ],
  },
  context: {
    eyebrow: "Context",
    title: "Context stays nearby, but never louder than the text itself.",
    body: "Supporting material sits in a calm, editorial frame. The emphasis stays on comprehension, with just enough structure to orient the reader when they need it.",
    notes: [
      { label: "Placement", value: "Contextual details sit in sequence instead of competing side panels." },
      { label: "Tone", value: "The palette remains monochrome and warm, without gradients or accent glare." },
      { label: "Focus", value: "Each block is shortened to the essentials so interpretation feels effortless." },
    ],
  },
};

function AppShell() {
  const [active, setActive] = useState<(typeof navItems)[number]>("shelf");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const section = sectionContent[active];

  if (settingsOpen) {
    return <SettingsView onBack={() => setSettingsOpen(false)} />;
  }

  return (
    <main className="flex h-screen flex-col bg-stone-100 text-stone-950">
      <header className="shrink-0 border-b border-border bg-stone-100 px-6 pt-6 pb-4 sm:px-10 sm:pt-8 lg:px-14">
        <nav
          aria-label="Primary"
          className="mx-auto flex max-w-5xl items-center gap-6 sm:gap-8"
        >
          {navItems.map((item) => (
            <NavItem
              key={item}
              active={item === active}
              onClick={() => setActive(item)}
            >
              {item}
            </NavItem>
          ))}

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="ml-auto -mr-2 flex items-center gap-2 rounded-full py-1 pl-3 pr-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-950"
          >
            <span>Jane Doe</span>
            <Avatar initials="JD" alt="Jane Doe" size="xs" />
          </button>
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto">
        <article className="mx-auto flex min-h-full max-w-5xl flex-col justify-center px-6 py-16 sm:px-10 sm:py-20 lg:px-14 lg:py-24">
          <Eyebrow>{section.eyebrow}</Eyebrow>
          <Display as="h1" size="7xl" className="mt-6 max-w-4xl">
            {section.title}
          </Display>
          <Body size="lg" className="mt-8 max-w-2xl">
            {section.body}
          </Body>

          <Divider className="mt-16" />
          <DefinitionList items={section.notes} columns={3} className="pt-8" />
        </article>

        <footer className="mx-auto max-w-5xl border-t border-border px-6 pt-4 pb-2 sm:px-10 lg:px-14">
          <Stack direction="horizontal" gap="lg">
            <Caption className="text-stone-600">
              <Kbd>1</Kbd> <Kbd>2</Kbd> switch sections
            </Caption>
            <Caption className="text-stone-600">
              <Kbd>?</Kbd> shortcuts
            </Caption>
          </Stack>
        </footer>
      </div>
    </main>
  );
}

const meta: Meta = {
  title: "Interface/App Shell",
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <AppShell />,
};
