import { createFileRoute, Link } from "@tanstack/react-router";
import { TopicPage, type TopicFaq } from "../components/TopicPage";
import { REPO_URL } from "../lib/releases";

export const Route = createFileRoute("/epub-reader-for-android")({
  head: () => ({
    meta: [
      { title: "EPUB Reader for Android That Syncs with Your Desktop — ReadAware" },
      {
        name: "description",
        content:
          "A free, open-source EPUB reader for Android. Reads MOBI, AZW3, FB2, PDF, CBZ, and CBR too, works fully offline, and syncs highlights, notes, and reading position with your desktop — end-to-end encrypted. Direct APK download.",
      },
    ],
  }),
  component: () => (
    <TopicPage
      title="An EPUB reader for Android that syncs with your desktop"
      lead="ReadAware on Android is the same reader as on your desktop: your books, your highlights, your place in each of them — free, open source, fully offline, and end-to-end encrypted when it syncs."
      faqs={FAQS}
    >
      <h2>A real reader, not a storefront</h2>
      <p>
        Most EPUB apps on Android are bookstores with a reader attached.
        ReadAware is only the reader: import your own DRM-free files and read
        them on a calm, paper-toned page, with highlights and notes that stay
        attached to the original text. There is no account to create, no ads,
        and no catalog pushing you anywhere — your library is the books you
        put in it.
      </p>

      <h2>Every format in your pocket</h2>
      <p>
        EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF all open in the
        same reader with the same selection, highlights, and progress —
        including comic archives, so your manga and comics live beside your
        novels. Nothing is converted; the original file is what you keep.
      </p>

      <h2>Pick up on your phone where your desktop left off</h2>
      <p>
        With the optional sync plan, the book you were reading at your desk is
        open at the same paragraph on your phone — books, highlights, notes,
        reading position, and the memory the assistant builds from all of it.
        Sync is end-to-end encrypted: the relay only stores ciphertext, so
        nobody in the middle can read what you read. ReadAware also runs on{" "}
        <Link to="/epub-reader-for-windows">Windows</Link>, macOS, and Linux.
      </p>

      <h2>Installing the APK</h2>
      <p>
        The Android build ships as a direct APK from the{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub releases page
        </a>{" "}
        — download it on your phone, open it, and confirm the install when
        Android asks about apps from outside the Play Store. Because the
        source is open (AGPL-3.0), what you install is exactly what's in the
        repository.
      </p>
    </TopicPage>
  ),
});

const FAQS: TopicFaq[] = [
  {
    question: "Is ReadAware on the Play Store?",
    answer:
      "Not yet. The Android app ships as a direct APK from the GitHub releases page — the download button on this page points at the latest stable build.",
  },
  {
    question: "Is the Android app free?",
    answer:
      "Yes. Reading, highlights, notes, and the assistant with your own API key are free and complete on Android, just like on desktop. Optional paid plans add end-to-end encrypted sync and built-in AI.",
  },
  {
    question: "Does sync cost anything?",
    answer:
      "Multi-device sync is part of the paid Sync plan; the reader itself stays free. Sync is end-to-end encrypted — the server only ever stores ciphertext.",
  },
  {
    question: "Which devices does the APK support?",
    answer:
      "The APK targets 64-bit ARM (arm64), which covers virtually every Android phone and tablet from the last several years.",
  },
  {
    question: "Does it work offline?",
    answer:
      "Yes. Importing, reading, annotating, and searching are all local. Airplane mode changes nothing about reading.",
  },
];
