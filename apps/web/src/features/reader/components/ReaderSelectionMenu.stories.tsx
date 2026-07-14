import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReaderSelectionState } from "../lib/selection-overlay";
import { ReaderSelectionMenu } from "./ReaderSelectionMenu";

// Anchor coordinates are container-space: useAnchoredMenuPosition measures the
// component's own inset-0 overlay, so the decorator frame must be `relative`
// and tall enough that the menu fits above the anchor.
const anchorRect = { left: 220, top: 200, width: 180, height: 20 };

const selection: ReaderSelectionState = {
  anchorRect,
  appearance: "selection",
  cfiRange: "epubcfi(/6/8!/4/2/14,/1:0,/1:74)",
  chapterHref: "chapter-03.xhtml",
  rects: [anchorRect],
  text: "Every action you take is a vote for the type of person you wish to become.",
};

const meta = {
  title: "Interface/Reader/ReaderSelectionMenu",
  component: ReaderSelectionMenu,
  parameters: { layout: "fullscreen" },
  args: {
    selection,
    onCopy: () => {},
    onHighlight: () => {},
    onUnderline: () => {},
    onAddNote: () => {},
    onLookUp: () => {},
    onAskAI: () => {},
  },
  decorators: [
    (Story) => (
      <div className="relative h-[28rem] overflow-hidden rounded-lg border border-border">
        {/* Faux selection wash at the anchor, so the menu's placement reads. */}
        <div
          aria-hidden="true"
          className="absolute bg-fg/10"
          style={{
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
            height: anchorRect.height,
          }}
        />
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderSelectionMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Annotatable format: copy plus highlight / underline / note / look-up / ask-AI. */
export const FullMenu: Story = {};

/** Fixed-layout (PDF) path: annotations disallowed, only copy is offered. */
export const CopyOnly: Story = {
  args: { allowAnnotations: false },
};
