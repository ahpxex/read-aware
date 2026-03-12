import { useCallback, useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocalAtom } from "../../../state/local";
import { ReaderShellOverlay } from "./ReaderShellOverlay";
import { EpubReaderView } from "./EpubReaderView";
import type { TocEntry } from "../lib/epub-types";
import demoEpubUrl from "../../../../demo/ElonMusk.epub?url";

const meta = {
  title: "Features/Reader/ReaderShellOverlay",
  component: ReaderShellOverlay,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ReaderShellOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

const demoToc: TocEntry[] = [
  {
    id: "intro",
    href: "intro.xhtml",
    label: "Introduction",
    depth: 0,
    spineIndex: 1,
  },
  {
    id: "chapter-1",
    href: "chapter-1.xhtml",
    label: "Chapter 1. A difficult childhood",
    depth: 0,
    spineIndex: 2,
  },
  {
    id: "chapter-1-section-1",
    href: "chapter-1.xhtml#origins",
    label: "Origins",
    depth: 1,
    spineIndex: 2,
  },
  {
    id: "chapter-2",
    href: "chapter-2.xhtml",
    label: "Chapter 2. First principles",
    depth: 0,
    spineIndex: 3,
  },
];

function ReaderShellDemo() {
  const [visible, setVisible] = useLocalAtom(false);
  const [currentChapterHref, setCurrentChapterHref] = useLocalAtom("chapter-2.xhtml");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setVisible((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative h-screen w-full">
      <EpubReaderView initialEpubUrl={demoEpubUrl} />

      <ReaderShellOverlay
        visible={visible}
        onBack={() => {}}
        title="Elon Musk"
        subtitle="Walter Isaacson"
        progress={0.12}
        currentPosition="Chapter 2 of 95"
        tocEntries={demoToc}
        currentChapterHref={currentChapterHref}
        onChapterSelect={setCurrentChapterHref}
      />

      {!visible && (
        <button
          type="button"
          onClick={() => setVisible(true)}
          className="fixed right-4 bottom-4 z-50 rounded-full bg-stone-900/70 px-3 py-1.5 font-sans text-caption text-white/80 backdrop-blur-sm transition-opacity hover:bg-stone-900/90"
        >
          Press Esc to toggle shell
        </button>
      )}
    </div>
  );
}

export const Default: Story = {
  args: { visible: false, onBack: () => {} },
  render: () => <ReaderShellDemo />,
};

function InteractiveDemo() {
  const [visible, setVisible] = useLocalAtom(false);
  const [currentChapterHref, setCurrentChapterHref] = useLocalAtom("chapter-2.xhtml");
  const toggle = useCallback(() => setVisible((v) => !v), []);
  const hide = useCallback(() => setVisible(false), []);

  return (
    <div className="relative h-screen w-full">
      <EpubReaderView
        initialEpubUrl={demoEpubUrl}
        onContentClick={toggle}
        onContentScroll={hide}
      />

      <ReaderShellOverlay
        visible={visible}
        onBack={() => {}}
        title="Elon Musk"
        subtitle="Walter Isaacson"
        progress={0.12}
        currentPosition="Chapter 2 of 95"
        tocEntries={demoToc}
        currentChapterHref={currentChapterHref}
        onChapterSelect={setCurrentChapterHref}
      />
    </div>
  );
}

export const Interactive: Story = {
  args: { visible: false, onBack: () => {} },
  render: () => <InteractiveDemo />,
};
