import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import type { ComponentProps } from "react";
import { ReaderNavigatorBar } from "./ReaderNavigatorBar";

// useDraggableFloat clamps drags against a live container element, so the
// frame owns the ref and overrides the placeholder ref passed through args.
function FramedNavigatorBar(props: ComponentProps<typeof ReaderNavigatorBar>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={containerRef}
      className="relative h-[26rem] overflow-hidden rounded-lg border border-border"
    >
      <ReaderNavigatorBar {...props} containerRef={containerRef} />
    </div>
  );
}

const meta = {
  title: "Interface/Reader/ReaderNavigatorBar",
  component: ReaderNavigatorBar,
  parameters: { layout: "fullscreen" },
  args: {
    visible: true,
    sentenceKey: "chapter-03.xhtml#s41",
    // Placeholder only — FramedNavigatorBar substitutes its live ref.
    containerRef: { current: null },
    canReturn: true,
    granularity: "sentence",
    onToggleGranularity: () => {},
    onToggleToolbars: () => {},
    onPrev: () => {},
    onNext: () => {},
    onReturnToSentence: () => {},
    onCopy: () => {},
    onHighlight: () => {},
    onUnderline: () => {},
    onAddNote: () => {},
    onLookUp: () => {},
    onAskAI: () => {},
    onExit: () => {},
  },
  render: (args) => <FramedNavigatorBar {...args} />,
} satisfies Meta<typeof ReaderNavigatorBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resting on a sentence: stepping, return-to-sentence, and every action enabled. */
export const OnSentence: Story = {};

/** No resting sentence: sentence-scoped actions disabled; stepping and exit stay live. */
export const NoRestingSentence: Story = {
  args: { sentenceKey: null, canReturn: false },
};

/** Paragraph granularity engaged: the quick toggle shows its pressed state. */
export const ParagraphMode: Story = {
  args: { granularity: "paragraph" },
};
