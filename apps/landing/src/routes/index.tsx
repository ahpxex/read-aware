import { createFileRoute } from "@tanstack/react-router";
import { Books, Brain, HardDrives, type Icon } from "@phosphor-icons/react";
import { Body, Button, Caption, Display, Divider, Eyebrow, Heading, Stack } from "@read-aware/ui";
import { WaitlistForm } from "../components/WaitlistForm";

function scrollToWaitlist() {
  document
    .getElementById("waitlist")
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const FEATURES: { title: string; body: string; icon: Icon }[] = [
  {
    title: "One engine, every format",
    body: "EPUB, MOBI, AZW3, FB2, and PDF render through a single reading engine — same selection, highlights, and progress, with no conversion.",
    icon: Books,
  },
  {
    title: "Memory, not transcripts",
    body: "Your reading becomes durable memory. ReadAware consolidates what matters and resurfaces it when it is relevant — not a wall of old chat.",
    icon: Brain,
  },
  {
    title: "Local-first and private",
    body: "Your library and memory live on your device. Bring your own API key; the cloud is only a quiet sync relay.",
    icon: HardDrives,
  },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-paper text-stone-950">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-serif text-lg font-medium tracking-tight text-stone-950">
          ReadAware
        </span>
        <nav className="flex items-center">
          <Button size="sm" onClick={scrollToWaitlist}>
            Join Waitlist
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-6 pb-24 pt-20 sm:pt-28">
          <Stack gap="lg" className="max-w-2xl">
            <Eyebrow>AI-native reading</Eyebrow>
            <Display size="6xl" className="max-w-[15ch]">
              Reading that remembers.
            </Display>
            <Body size="lg" className="max-w-xl text-stone-600">
              ReadAware reads alongside you — building memory across your books,
              highlights, and conversations, so every page arrives with the
              context it deserves.
            </Body>
            <div id="waitlist" className="w-full pt-2">
              <WaitlistForm />
            </div>
            <Caption className="pt-1 text-stone-400">
              EPUB · MOBI · AZW3 · FB2 · PDF — one reading experience.
            </Caption>
          </Stack>
        </section>

        <Divider className="mx-auto max-w-5xl" />

        <section className="mx-auto max-w-5xl px-6 py-20">
          <div className="grid gap-12 sm:grid-cols-3">
            {FEATURES.map(({ title, body, icon: FeatureIcon }) => (
              <Stack key={title} gap="sm">
                <FeatureIcon
                  size={24}
                  weight="light"
                  aria-hidden="true"
                  className="text-stone-500"
                />
                <Heading as="h3" size="xl">
                  {title}
                </Heading>
                <Body className="text-stone-600">{body}</Body>
              </Stack>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-6 py-10">
        <Divider className="mb-8" />
        <div className="flex items-center justify-between">
          <span className="font-serif text-sm font-medium text-stone-700">
            ReadAware
          </span>
          <Caption className="text-stone-400">Local-first. Yours.</Caption>
        </div>
      </footer>
    </div>
  );
}
