import { createFileRoute } from "@tanstack/react-router";
import { DownloadMenu } from "../components/DownloadMenu";
import { DownloadSection } from "../components/DownloadSection";
import { useLatestRelease } from "../hooks/useLatestRelease";
import { REPO_URL } from "../lib/releases";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const CONTACT_EMAIL = "hi@ahpx.me";
const DISCORD_URL = "https://discord.gg/whDrKXwHWU";
const HEADER_ICON_URL = "/favicon.png?v=2235eb1";
const SHELF_SCREENSHOT_URL = "/screenshots/shelf.webp?v=b2e29b2";

const NOTES: { title: string; body: string }[] = [
  {
    title: "One engine, every format",
    body: "EPUB, MOBI, AZW3, FB2, and PDF open in the same reader, with the same selection, highlights, and progress. Nothing is converted; the original file is what you keep.",
  },
  {
    title: "Memory, not transcripts",
    body: "Reading becomes memory the app can hold onto. ReadAware keeps what matters and brings it back when it's relevant, instead of replaying a long chat history.",
  },
  {
    title: "Local-first and private",
    body: "Your library and your memory live on your device. You bring your own API key, and the cloud is only there to sync between machines.",
  },
];

// A screenshot printed as a plate: a hairline frame does the separating, and a
// plain caption says what it is. No shadow, no border-radius, no figure number.
function Plate({
  src,
  alt,
  caption,
  eager = false,
}: {
  src: string;
  alt: string;
  caption: string;
  eager?: boolean;
}) {
  return (
    <figure className="m-0">
      <img
        src={src}
        alt={alt}
        width={2400}
        height={1600}
        loading={eager ? "eager" : "lazy"}
        className="block w-full border border-border-strong"
      />
      <figcaption className="mt-3 text-[0.9375rem] italic leading-normal text-fg-muted">
        {caption}
      </figcaption>
    </figure>
  );
}

function LandingPage() {
  const release = useLatestRelease();

  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-3xl px-6">
        <header className="flex items-center justify-between py-7">
          <a href="#top" className="flex items-center gap-2.5">
            <img src={HEADER_ICON_URL} alt="" width={26} height={26} className="h-[26px] w-[26px]" />
            <span className="text-[1.0625rem] font-medium tracking-tight">
              ReadAware
            </span>
          </a>
          <nav className="flex items-center gap-6 text-[0.9375rem] text-fg-muted">
            <a href="#download" className="transition-colors hover:text-fg">
              Download
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-fg"
            >
              GitHub
            </a>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-fg"
            >
              Discord
            </a>
          </nav>
        </header>

        <main id="top">
          {/* Title */}
          <section className="max-w-[36rem] pt-12 sm:pt-16">
            <h1 className="text-[clamp(2.1rem,4.8vw,3rem)] font-normal leading-[1.12] tracking-[-0.01em]">
              Reading that remembers
            </h1>
            <p className="mt-6 text-[1.1875rem] leading-[1.75] text-fg">
              ReadAware reads alongside you. It builds memory across your books,
              highlights, and conversations, so every page arrives with the
              context it deserves.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <DownloadMenu
                downloads={release.downloads}
                platform={release.platform}
              />
              <span className="text-[0.9375rem] text-fg-muted">
                Free and local-first{release.tag ? `. ${release.tag}.` : "."}
              </span>
            </div>
          </section>

          {/* Plate: the shelf */}
          <div className="mt-14 sm:mt-16">
            <Plate
              src={SHELF_SCREENSHOT_URL}
              alt="The ReadAware library — a grid of book covers across many languages and formats."
              caption="Your library — every format in one place."
              eager
            />
          </div>

          {/* The page */}
          <section className="mt-20 max-w-[36rem] sm:mt-24">
            <h2 className="text-[clamp(1.5rem,3vw,1.9rem)] font-normal leading-[1.18] tracking-[-0.01em]">
              A calm place to read anything
            </h2>
            <p className="mt-5 text-[1.0625rem] leading-[1.75] text-fg">
              Import a file and start reading. There is no conversion and no
              cloud upload; your highlights, notes, and place in the book attach
              to the original text and stay where you left them, in any format.
            </p>
          </section>
          <div className="mt-10">
            <Plate
              src="/screenshots/reader.webp"
              alt="A chapter of a biography open in the ReadAware reader, set in a serif typeface."
              caption="A chapter of Isaacson's Musk, open in the reader."
            />
          </div>

          {/* The memory */}
          <section className="mt-20 max-w-[36rem] sm:mt-24">
            <h2 className="text-[clamp(1.5rem,3vw,1.9rem)] font-normal leading-[1.18] tracking-[-0.01em]">
              It remembers what you read
            </h2>
            <p className="mt-5 text-[1.0625rem] leading-[1.75] text-fg">
              Ask about a passage, a book, or your whole shelf. ReadAware draws
              on your highlights, notes, and earlier conversations, and keeps a
              durable memory of what matters, so it picks up where you left off.
            </p>
          </section>
          <div className="mt-10">
            <Plate
              src="/screenshots/context.webp"
              alt="The ReadAware assistant recalling the reader's whole library, reading progress, and preferences."
              caption="The assistant, working from your own reading."
            />
          </div>

          {/* In short */}
          <section className="mt-20 max-w-[36rem] sm:mt-24">
            <h2 className="text-[clamp(1.5rem,3vw,1.9rem)] font-normal leading-[1.18] tracking-[-0.01em]">
              In short
            </h2>
            <dl className="mt-8">
              {NOTES.map(({ title, body }, index) => (
                <div
                  key={title}
                  className={
                    index === 0
                      ? "py-5"
                      : "border-t border-border py-5"
                  }
                >
                  <dt className="text-[1.0625rem] font-medium">{title}</dt>
                  <dd className="mt-1.5 text-[1.0625rem] leading-[1.7] text-fg-muted">
                    {body}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Download */}
          <DownloadSection
            downloads={release.downloads}
            platform={release.platform}
            tag={release.tag}
          />
        </main>

        <footer className="mt-8 flex flex-col gap-3 border-t border-border py-8 text-[0.9375rem] text-fg-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <img src={HEADER_ICON_URL} alt="" width={20} height={20} className="h-5 w-5" />
            <span className="text-fg">ReadAware</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-fg"
            >
              GitHub
            </a>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-fg"
            >
              Discord
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="transition-colors hover:text-fg"
            >
              {CONTACT_EMAIL}
            </a>
            <span>Local-first. Yours.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
