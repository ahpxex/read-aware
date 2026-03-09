import type { Meta, StoryObj } from "@storybook/react";
import {
  NavItem,
  Breadcrumb,
  Eyebrow,
  Display,
  Body,
  Divider,
  Caption,
  Progress,
  IconButton,
  Kbd,
  Stack,
} from "../components";

const navItems = ["shelf", "context", "settings"] as const;

const chapterText = [
  "The stranger's eyes were remarkable. The left was black, the right for some reason green. His brows were black, but one was higher than the other. In short, he was a foreigner.",
  "He looked down at the city spread out before him on the far side of the river, where fragmented reflections of the sun sparkled and smoked above thousands of rooftops, and beyond the city, into a haze in which no eye could distinguish anything, and he smiled.",
  "The heat was becoming unbearable. The linden trees gave off a sweet scent. No one wanted to go anywhere. The city was emptying. The stranger sat on a bench and opened a silver cigarette case.",
  "He was a man of medium height, well dressed, with a sharp, intelligent face. He wore an expensive grey suit, foreign shoes, and a grey beret cocked rakishly over one ear. Under his arm he carried a walking stick with a black knob in the shape of a poodle's head.",
  "The editor wiped his brow with a crumpled handkerchief and, having established that the sun had well and truly set, though the heat persisted, launched into a description of the terrible death of Berlioz.",
];

function ReaderScreen() {
  return (
    <main className="min-h-screen bg-stone-100 text-stone-950">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14">
        <header className="border-b border-border pb-4">
          <nav aria-label="Primary" className="flex flex-wrap gap-6 sm:gap-8">
            {navItems.map((item) => (
              <NavItem key={item}>{item}</NavItem>
            ))}
          </nav>
        </header>

        <Progress value={64} size="sm" className="mt-1" />

        <div className="mx-auto w-full max-w-2xl flex-1 py-12 sm:py-16">
          <Breadcrumb
            items={[
              { label: "Shelf", onClick: () => {} },
              { label: "The Master and Margarita" },
            ]}
          />

          <Eyebrow className="mt-10">Part One</Eyebrow>
          <Display as="h1" size="6xl" className="mt-4">
            Chapter 1. Never Talk to Strangers
          </Display>

          <Divider className="mt-8" />

          <div className="mt-10 space-y-8">
            {chapterText.map((paragraph, i) => (
              <Body key={i} size="lg" className="font-serif leading-body">
                {paragraph}
              </Body>
            ))}
          </div>

          <Divider className="mt-16" />

          <Stack direction="horizontal" gap="md" className="mt-6 items-center justify-between">
            <IconButton icon={<ChevronLeft />} label="Previous chapter" />
            <Caption className="text-stone-600">Chapter 1 of 32</Caption>
            <IconButton icon={<ChevronRight />} label="Next chapter" />
          </Stack>

          <Caption className="mt-12 text-center text-stone-600">
            <Kbd>&larr;</Kbd> <Kbd>&rarr;</Kbd> navigate chapters
          </Caption>
        </div>
      </div>
    </main>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

const meta: Meta = {
  title: "Interface/Reader",
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <ReaderScreen />,
};
