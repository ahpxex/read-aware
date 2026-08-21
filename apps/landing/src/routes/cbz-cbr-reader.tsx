import { createFileRoute, Link } from "@tanstack/react-router";
import { Plate } from "../components/Plate";
import { TopicPage, type TopicFaq } from "../components/TopicPage";

export const Route = createFileRoute("/cbz-cbr-reader")({
  head: () => ({
    meta: [
      { title: "Free CBZ & CBR Comic Book Reader for Desktop and Android — ReadAware" },
      {
        name: "description",
        content:
          "Read CBZ and CBR comic archives directly — no conversion — on Windows, macOS, Linux, and Android. A free, open-source reader that keeps comics and ebooks in one library, with progress that syncs end-to-end encrypted.",
      },
    ],
  }),
  component: () => (
    <TopicPage
      title="A CBZ & CBR reader for your comics — and everything else"
      lead="ReadAware opens CBZ and CBR archives directly, no conversion and no extraction, on Windows, macOS, Linux, and Android — a free, open-source reader where your comics live on the same shelf as your books."
      faqs={FAQS}
    >
      <h2>The archive is the book</h2>
      <p>
        A CBZ or CBR file is just a zipped or RAR-packed folder of page
        images, and most tools make you convert it or unpack it before
        reading. ReadAware treats the archive itself as the book: import it
        and read, page by page, with your position remembered per comic. The
        file you downloaded is the file you keep — nothing is converted,
        re-compressed, or uploaded anywhere.
      </p>

      <h2>Comics and books on one shelf</h2>
      <p>
        Comic readers tend to be a separate world from ebook readers.
        ReadAware's single engine reads CBZ and CBR alongside EPUB, MOBI,
        AZW3, FB2, TXT, HTML, and PDF, so one library holds your whole
        collection — graphic novels next to prose, manga next to reference
        PDFs — with one reading history across all of it.
      </p>

      <div className="my-10">
        <Plate
          base="shelf"
          alt="The ReadAware library — comics and books across many formats and languages on one shelf."
          caption="One library for comics and books alike."
        />
      </div>

      <h2>Your place follows you</h2>
      <p>
        On its own, everything is local-first: your comics and your progress
        live on your device and reading works fully offline. With the
        optional sync plan, the issue you stopped reading on your desktop is
        open at the same page on your phone, end-to-end encrypted in transit
        — the relay only ever stores ciphertext. ReadAware is open source
        (AGPL-3.0) and free on{" "}
        <Link to="/epub-reader-for-windows">Windows</Link>, macOS, Linux, and{" "}
        <Link to="/epub-reader-for-android">Android</Link>.
      </p>
    </TopicPage>
  ),
});

const FAQS: TopicFaq[] = [
  {
    question: "What are CBZ and CBR files?",
    answer:
      "Comic book archives: a CBZ is a ZIP and a CBR is a RAR, each containing the comic's pages as images in reading order. ReadAware opens both directly, without unpacking or converting them.",
  },
  {
    question: "Do I need to convert my comics first?",
    answer:
      "No. Import the CBZ or CBR as-is and start reading. The original archive stays untouched — it's the copy you keep.",
  },
  {
    question: "Is it free?",
    answer:
      "Yes. Reading comics — and everything else ReadAware does with your library — is free, and the code is open source under AGPL-3.0. Optional paid plans add end-to-end encrypted sync and built-in AI.",
  },
  {
    question: "Does my reading progress sync between devices?",
    answer:
      "With the optional Sync plan, yes — your library and your place in each comic follow you between desktop and Android, end-to-end encrypted.",
  },
  {
    question: "What platforms does it run on?",
    answer:
      "Windows, macOS, and Linux on desktop, and Android via a direct APK. iOS is on the way.",
  },
];
