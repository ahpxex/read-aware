import { createFileRoute } from "@tanstack/react-router";
import {
  Books,
  Brain,
  DownloadSimple,
  GithubLogo,
  HardDrives,
  type Icon,
} from "@phosphor-icons/react";
import {
  Body,
  Caption,
  Display,
  Divider,
  Eyebrow,
  Heading,
  Stack,
} from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { LinkButton } from "../components/LinkButton";
import { DownloadSection } from "../components/DownloadSection";
import { useLatestRelease } from "../hooks/useLatestRelease";
import { REPO_URL } from "../lib/releases";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const CONTACT_EMAIL = "hi@ahpx.me";

const PILLARS: { title: string; body: string; icon: Icon }[] = [
  {
    title: "One engine, every format",
    body: "EPUB, MOBI, AZW3, FB2, and PDF render through a single reading engine — the same selection, highlights, and progress, with no conversion.",
    icon: Books,
  },
  {
    title: "Memory, not transcripts",
    body: "Your reading becomes durable memory. ReadAware consolidates what matters and resurfaces it when it's relevant — not a wall of old chat.",
    icon: Brain,
  },
  {
    title: "Local-first and private",
    body: "Your library and memory live on your device. Bring your own API key; the cloud is only a quiet sync relay.",
    icon: HardDrives,
  },
];

function Screenshot({
  src,
  alt,
  eager = false,
  className,
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-paper-warm shadow-[0_1px_2px_rgba(28,25,23,0.04),0_18px_50px_-16px_rgba(28,25,23,0.22)]",
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        width={2400}
        height={1600}
        loading={eager ? "eager" : "lazy"}
        className="block w-full"
      />
    </div>
  );
}

function LandingPage() {
  const release = useLatestRelease();
  const detected = release.platform
    ? release.downloads.find((download) => download.id === release.platform)
    : undefined;
  const heroDownload =
    detected && detected.primary && !detected.comingSoon
      ? { label: `Download for ${detected.name}`, url: detected.primary.url }
      : null;

  return (
    <div className="min-h-screen bg-paper text-stone-950">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-serif text-lg font-medium tracking-tight text-stone-950">
          ReadAware
        </span>
        <nav className="flex items-center gap-1">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="ReadAware on GitHub"
            className="flex h-9 w-9 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-fg/5 hover:text-stone-900"
          >
            <GithubLogo size={20} weight="regular" aria-hidden="true" />
          </a>
          <LinkButton href="#download" size="sm">
            Download
          </LinkButton>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-6 pb-16 pt-16 sm:pt-24">
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
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <LinkButton
                href={heroDownload?.url ?? "#download"}
                size="lg"
                variant="solid"
              >
                <DownloadSimple size={18} weight="bold" aria-hidden="true" />
                {heroDownload?.label ?? "Download"}
              </LinkButton>
              <LinkButton href="#download" size="lg" variant="outline">
                All platforms
              </LinkButton>
            </div>
            <Caption className="text-stone-400">
              {release.tag ? `${release.tag} · ` : ""}
              Free · local-first · bring your own AI key
            </Caption>
          </Stack>

          <div className="mt-14">
            <Screenshot
              src="/screenshots/shelf.webp"
              alt="The ReadAware library — a shelf of book covers across many languages and formats."
              eager
            />
            <Caption className="mt-3 block text-stone-400">
              EPUB · MOBI · AZW3 · FB2 · PDF — one reading experience.
            </Caption>
          </div>
        </section>

        <Divider className="mx-auto max-w-5xl" />

        {/* Showcase: reading */}
        <section className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Stack gap="md" className="max-w-md">
              <Eyebrow>The reading surface</Eyebrow>
              <Heading as="h2" size="3xl">
                A calm place to read anything.
              </Heading>
              <Body className="text-stone-600">
                Import a file and start reading — no conversion, no cloud upload.
                Highlights, notes, and progress attach to the original text and
                stay exactly where you left them, whatever the format.
              </Body>
            </Stack>
            <Screenshot
              src="/screenshots/reader.webp"
              alt="A chapter of a biography open in the ReadAware reader, set in a serif typeface."
            />
          </div>
        </section>

        {/* Showcase: memory / AI */}
        <section className="mx-auto max-w-5xl px-6 pb-20 sm:pb-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Screenshot
              src="/screenshots/context.webp"
              alt="The ReadAware assistant recalling the reader's whole library, reading progress, and preferences."
              className="lg:order-2"
            />
            <Stack gap="md" className="max-w-md lg:order-1">
              <Eyebrow>Context &amp; memory</Eyebrow>
              <Heading as="h2" size="3xl">
                An assistant that remembers your reading.
              </Heading>
              <Body className="text-stone-600">
                Ask about a passage, a book, or your whole shelf. ReadAware pulls
                from your highlights, notes, and past conversations — and keeps a
                durable memory of what matters, so it picks up where you left off.
              </Body>
            </Stack>
          </div>
        </section>

        <Divider className="mx-auto max-w-5xl" />

        {/* Pillars */}
        <section className="mx-auto max-w-5xl px-6 py-20">
          <div className="grid gap-12 sm:grid-cols-3">
            {PILLARS.map(({ title, body, icon: PillarIcon }) => (
              <Stack key={title} gap="sm">
                <PillarIcon
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

        <Divider className="mx-auto max-w-5xl" />

        {/* Download */}
        <DownloadSection
          downloads={release.downloads}
          platform={release.platform}
          tag={release.tag}
        />
      </main>

      <footer className="mx-auto max-w-5xl px-6 py-10">
        <Divider className="mb-8" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-serif text-sm font-medium text-stone-700">
            ReadAware
          </span>
          <div className="flex items-center gap-5">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-sm text-stone-500 transition-colors hover:text-stone-900"
            >
              GitHub
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-sans text-sm text-stone-500 transition-colors hover:text-stone-900"
            >
              {CONTACT_EMAIL}
            </a>
            <Caption className="text-stone-400">Local-first. Yours.</Caption>
          </div>
        </div>
      </footer>
    </div>
  );
}
