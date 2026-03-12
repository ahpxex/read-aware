import { useCallback, useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReaderShellOverlay } from "./ReaderShellOverlay";
import { EpubReaderView } from "./EpubReaderView";
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

function ReaderShellDemo() {
  const [visible, setVisible] = useState(false);

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
  const [visible, setVisible] = useState(false);
  const toggle = useCallback(() => setVisible((v) => !v), []);

  return (
    <div className="relative h-screen w-full">
      <EpubReaderView
        initialEpubUrl={demoEpubUrl}
        onContentClick={toggle}
      />

      <ReaderShellOverlay
        visible={visible}
        onBack={() => {}}
        onOverlayClick={toggle}
        title="Elon Musk"
        subtitle="Walter Isaacson"
        progress={0.12}
        currentPosition="Chapter 2 of 95"
      />
    </div>
  );
}

export const Interactive: Story = {
  args: { visible: false, onBack: () => {} },
  render: () => <InteractiveDemo />,
};
