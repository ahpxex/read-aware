import { createFileRoute, Link } from "@tanstack/react-router";
import { Plate } from "../components/Plate";
import { TopicPage, type TopicFaq } from "../components/TopicPage";
import { REPO_URL } from "../lib/releases";

export const Route = createFileRoute("/open-source-ebook-reader")({
  head: () => ({
    meta: [
      { title: "Open-Source Ebook Reader for Desktop & Android — ReadAware" },
      {
        name: "description",
        content:
          "ReadAware is a free, open-source (AGPL-3.0) ebook reader for Windows, macOS, Linux, and Android. EPUB, MOBI, PDF, and comics in one local-first reader with highlights, notes, an AI assistant, and end-to-end encrypted sync.",
      },
    ],
  }),
  component: () => (
    <TopicPage
      title="An open-source ebook reader that remembers what you read"
      lead="ReadAware is a free, open-source ebook reader for Windows, macOS, Linux, and Android — AGPL-3.0, local-first, with an assistant that answers from your own books, highlights, and notes."
      faqs={FAQS}
    >
      <h2>Why open source matters in a reading app</h2>
      <p>
        A library is one of the more intimate datasets a person has: what you
        read, what you underline, what you ask about a difficult passage at
        1&nbsp;a.m. An app that watches you read should be one you can watch
        back. ReadAware's source is public on{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>{" "}
        under the AGPL-3.0 license — you can read exactly what the app does
        with your data, build it yourself, and the license keeps every
        derivative just as open.
      </p>

      <h2>Every format, one reader</h2>
      <p>
        EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF open in the same
        reader, with the same selection, highlights, and reading progress.
        Nothing is converted and nothing is uploaded: the file you import is
        the file you keep, and your annotations stay attached to the original
        text. ReadAware reads DRM-free files; DRM-protected books are
        surfaced as unsupported rather than half-working.
      </p>

      <h2>Local-first, no account</h2>
      <p>
        Everything — your books, highlights, notes, and the memory the app
        builds from them — lives in a local database on your device. Import,
        read, annotate, and search all work offline. There is no sign-up to
        start reading, and if the project disappeared tomorrow, your library
        would still open on your machine.
      </p>

      <h2>An AI assistant on your own key</h2>
      <p>
        The built-in assistant answers questions about a passage, a book, or
        your whole shelf — from your own reading, not a generic summary. It
        runs on an API key you bring, so requests go straight from your
        machine to the provider you chose, with no ReadAware server in the
        middle. Optional paid plans add built-in AI and end-to-end encrypted
        sync between devices; the reader itself is free and complete.
      </p>

      <div className="my-10">
        <Plate
          base="shelf"
          alt="The ReadAware library — a grid of book covers across many languages and formats."
          caption="Your library — every format in one place, on your device."
        />
      </div>

      <h2>Extensible from the inside</h2>
      <p>
        Sandboxed plugins from the built-in marketplace add read-aloud voices,
        dictionaries, reading themes, and feeds that read like books — and a
        plugin can hand the assistant a new tool it simply starts using. The
        plugin system is part of the same open codebase, with a{" "}
        <Link to="/docs/plugins">documented public API</Link>.
      </p>
    </TopicPage>
  ),
});

const FAQS: TopicFaq[] = [
  {
    question: "Is ReadAware really free?",
    answer:
      "Yes. The app is free and complete — reading, highlights, notes, plugins, and the assistant with your own API key. Optional paid plans add end-to-end encrypted sync and built-in AI, but nothing about reading is behind them.",
  },
  {
    question: "What license is the code under?",
    answer:
      "AGPL-3.0. The full source is on GitHub, and the license guarantees that any derivative of ReadAware must stay open source too.",
  },
  {
    question: "Does it work offline?",
    answer:
      "Yes. ReadAware is local-first: books, annotations, and memory live in a local database, and importing, reading, annotating, and searching never touch a network. The network is only used for optional sync and for the AI assistant.",
  },
  {
    question: "Does it read DRM-protected books?",
    answer:
      "No. ReadAware reads DRM-free files and tells you clearly when a file is DRM-protected instead of failing halfway. Books you own without DRM — EPUB, MOBI, AZW3, FB2, PDF, and comic archives — open directly.",
  },
  {
    question: "How is ReadAware different from Calibre?",
    answer:
      "Calibre is a library manager and format converter with a reader attached. ReadAware is reading-first: it opens your original files without conversion, and its distinctive part is memory — an assistant that knows what you've highlighted, asked, and read across your whole shelf.",
  },
];
