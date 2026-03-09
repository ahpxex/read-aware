import type { Meta, StoryObj } from "@storybook/react";
import {
  NavItem,
  Eyebrow,
  Heading,
  Body,
  Caption,
  Divider,
  Card,
  DefinitionList,
  Accordion,
  Tag,
  Spinner,
  Skeleton,
  Stack,
} from "../components";

const navItems = ["shelf", "context", "settings"] as const;

const sourcePassages = [
  "The stranger's eyes were remarkable. The left was black, the right for some reason green. His brows were black, but one was higher than the other. In short, he was a foreigner.",
  "He looked down at the city spread out before him on the far side of the river, where fragmented reflections of the sun sparkled and smoked above thousands of rooftops.",
  "The heat was becoming unbearable. The linden trees gave off a sweet scent. No one wanted to go anywhere.",
];

const selectedIndex = 0;

const contextFacts = [
  { label: "Novel", value: "The Master and Margarita" },
  { label: "Author", value: "Mikhail Bulgakov (1891-1940)" },
  { label: "Written", value: "1928-1940, published posthumously 1967" },
  { label: "Setting", value: "Moscow, 1930s Soviet Union" },
];

const concepts = ["Magical realism", "Soviet satire", "Faustian bargain", "Censorship", "Dual narrative"];

const accordionSections = [
  {
    label: "Historical context",
    content: (
      <Body>
        Bulgakov wrote during Stalin's Great Purge. The novel's depiction of a
        devil visiting Moscow satirizes Soviet bureaucracy and artistic
        censorship. The manuscript was revised over twelve years and never
        published in the author's lifetime.
      </Body>
    ),
  },
  {
    label: "Character analysis",
    content: (
      <Body>
        Woland, the devil figure, serves as a catalyst for revealing the
        hypocrisy and cowardice of Moscow's literary establishment. His
        foreignness -- marked by mismatched eyes -- signals otherness in a
        society suspicious of outsiders.
      </Body>
    ),
  },
  {
    label: "Literary connections",
    content: (
      <Body>
        The novel draws on Goethe's Faust, the Gospels, and E.T.A. Hoffmann's
        fantastic tales. The dual-narrative structure alternates between 1930s
        Moscow and ancient Jerusalem, linking political cowardice across
        millennia.
      </Body>
    ),
  },
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-100 text-stone-950">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14">
        <header className="border-b border-border pb-4">
          <nav aria-label="Primary" className="flex flex-wrap gap-6 sm:gap-8">
            {navItems.map((item) => (
              <NavItem key={item} active={item === "context"}>{item}</NavItem>
            ))}
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}

function ContextPanelScreen() {
  return (
    <Shell>
      <div className="grid flex-1 gap-10 py-8 lg:grid-cols-[1fr_380px]">
        {/* Source text column */}
        <div>
          <Eyebrow>Source Text</Eyebrow>
          <Heading as="h2" size="2xl" className="mt-4">
            Chapter 1. Never Talk to Strangers
          </Heading>
          <div className="mt-6 space-y-4">
            {sourcePassages.map((text, i) => (
              i === selectedIndex ? (
                <Card key={i} variant="filled" padding="md">
                  <Card.Body>
                    <Body size="lg" className="font-serif leading-body">{text}</Body>
                  </Card.Body>
                </Card>
              ) : (
                <Body key={i} size="lg" className="font-serif leading-body text-stone-600">{text}</Body>
              )
            ))}
          </div>
        </div>

        {/* AI context column */}
        <aside className="lg:border-l lg:border-border lg:pl-10">
          <Eyebrow>AI Context</Eyebrow>

          <Heading as="h3" size="xl" className="mt-6">Summary</Heading>
          <Body className="mt-2 text-stone-600">
            The opening passage introduces a mysterious foreigner through
            physical description alone. His mismatched eyes and foreign dress
            mark him as an outsider in Soviet Moscow, establishing the novel's
            central tension between the familiar and the uncanny.
          </Body>

          <Divider className="my-6" />

          <Heading as="h3" size="xl">Facts</Heading>
          <DefinitionList items={contextFacts} className="mt-3" />

          <Divider className="my-6" />

          <Heading as="h3" size="xl">Concepts</Heading>
          <Stack direction="horizontal" gap="sm" className="mt-3 flex-wrap">
            {concepts.map((c) => (
              <Tag key={c}>{c}</Tag>
            ))}
          </Stack>

          <Divider className="my-6" />

          <Accordion items={accordionSections} />
        </aside>
      </div>
    </Shell>
  );
}

function LoadingContextPanel() {
  return (
    <Shell>
      <div className="grid flex-1 gap-10 py-8 lg:grid-cols-[1fr_380px]">
        <div>
          <Eyebrow>Source Text</Eyebrow>
          <Heading as="h2" size="2xl" className="mt-4">
            Chapter 1. Never Talk to Strangers
          </Heading>
          <div className="mt-6 space-y-4">
            {sourcePassages.map((text, i) => (
              <Body key={i} size="lg" className="font-serif leading-body text-stone-600">{text}</Body>
            ))}
          </div>
        </div>

        <aside className="lg:border-l lg:border-border lg:pl-10">
          <Eyebrow>AI Context</Eyebrow>

          <div className="mt-6 flex items-center gap-3">
            <Spinner size="sm" />
            <Caption className="text-stone-600">Generating context...</Caption>
          </div>

          <div className="mt-8 space-y-6">
            <Skeleton lines={3} />
            <Skeleton width="60%" />
            <Skeleton lines={2} />
            <Skeleton width="40%" />
          </div>
        </aside>
      </div>
    </Shell>
  );
}

const meta: Meta = {
  title: "Interface/Context Panel",
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <ContextPanelScreen />,
};

export const Loading: Story = {
  render: () => <LoadingContextPanel />,
};

