import { createFileRoute, Link } from "@tanstack/react-router";
import { Plate } from "../components/Plate";
import { TopicPage, type TopicFaq } from "../components/TopicPage";

export const Route = createFileRoute("/epub-reader-for-windows")({
  head: () => ({
    meta: [
      { title: "Free EPUB Reader for Windows — ReadAware" },
      {
        name: "description",
        content:
          "Read EPUB on Windows with a free, open-source reader — plus MOBI, AZW3, FB2, PDF, and comics. Highlights, notes, and an AI assistant that knows your library. Installer, MSI, and portable ZIP; no account needed.",
      },
    ],
  }),
  component: () => (
    <TopicPage
      title="A free EPUB reader for Windows"
      lead="ReadAware reads EPUB on Windows the way a book deserves — a calm, paper-toned page, highlights and notes that stay with the text, and an assistant that knows your whole library. Free, open source, and yours offline."
      faqs={FAQS}
    >
      <h2>Reading EPUB on Windows, minus the friction</h2>
      <p>
        Windows still has no good built-in way to open an EPUB. ReadAware is a
        desktop app, not a browser tab: install it once, drop your files in,
        and read. There is no account to create, no cloud upload, and no
        conversion step — the EPUB you import is the EPUB you keep, with your
        highlights, notes, and reading position attached to the original
        text. It ships as a regular installer, an MSI, or a portable ZIP that
        runs from a folder without installing anything.
      </p>

      <h2>Not just EPUB</h2>
      <p>
        The same reader opens MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF,
        with the same selection, highlights, and progress in every format. A
        DRM-free Kindle file reads as comfortably as an EPUB; a comic archive
        sits on the same shelf as your novels.
      </p>

      <div className="my-10">
        <Plate
          base="reader"
          alt="A page of Pride and Prejudice in the ReadAware reader on desktop, one sentence held in focus while the rest of the page recedes."
          caption="Reading Pride and Prejudice one sentence at a time."
        />
      </div>

      <h2>Reading that leaves a trace you can use</h2>
      <p>
        Highlight a line and it stays highlighted; add a note and it stays
        with the passage. When you want more focus, read sentence by sentence
        — the page holds back, a floating strip steps you through, and
        read-aloud can follow along. And everything you mark feeds the
        assistant: ask about a passage, a book, or your whole shelf, and it
        answers from your own reading, on an API key you bring.
      </p>

      <h2>Your desktop reading, on your phone too</h2>
      <p>
        ReadAware also runs on macOS, Linux, and{" "}
        <Link to="/epub-reader-for-android">Android</Link>. With the optional
        sync plan, your books, highlights, and place in each of them follow
        you between machines, end-to-end encrypted — the relay only ever
        stores ciphertext.
      </p>
    </TopicPage>
  ),
});

const FAQS: TopicFaq[] = [
  {
    question: "Is the Windows version free?",
    answer:
      "Yes. Reading, highlights, notes, plugins, and the assistant with your own API key are free and complete. Optional paid plans add end-to-end encrypted sync and built-in AI.",
  },
  {
    question: "Windows warned me about an unrecognized app — is that expected?",
    answer:
      "Yes, for now. Desktop builds aren't code-signed yet, so SmartScreen may ask you to confirm the app on first launch. The source is open (AGPL-3.0) and every build comes from the public GitHub releases page, so you can verify exactly what you're running.",
  },
  {
    question: "Can it read Kindle files (MOBI, AZW3)?",
    answer:
      "Yes — DRM-free MOBI and AZW3 files open directly, no conversion needed. DRM-protected books are surfaced as unsupported.",
  },
  {
    question: "Is there a portable version?",
    answer:
      "Yes. Alongside the installer and MSI there's a portable ZIP that unpacks into a folder and runs from there, with nothing to install.",
  },
  {
    question: "Does it need an internet connection?",
    answer:
      "No. ReadAware is local-first: importing, reading, annotating, and searching all work offline. The network is only used for optional sync and the AI assistant.",
  },
];
