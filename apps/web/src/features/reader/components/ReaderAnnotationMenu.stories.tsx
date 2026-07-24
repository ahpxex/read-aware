import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SelectionOverlayRect } from "../lib/selection-overlay";
import { ReaderAnnotationMenu } from "./ReaderAnnotationMenu";

// Anchor coordinates are container-space: useAnchoredMenuPosition measures the
// component's own inset-0 overlay, so the decorator frame must be `relative`
// and tall enough that the menu fits above the anchor.
const anchorRect: SelectionOverlayRect = { left: 200, top: 200, width: 220, height: 22 };

const meta = {
  title: "Interface/Reader/ReaderAnnotationMenu",
  component: ReaderAnnotationMenu,
  parameters: { layout: "fullscreen" },
  args: {
    anchorRect,
    activeColor: "yellow",
    onRecolor: () => {},
    onCopy: () => {},
    onAddNote: () => {},
    onAskAI: () => {},
    onRemove: () => {},
  },
  decorators: [
    (Story) => (
      <div className="relative h-[28rem] overflow-hidden rounded-lg border border-border">
        {/* Faux tapped highlight at the anchor, so the menu's placement reads. */}
        <div
          aria-hidden="true"
          className="absolute bg-yellow-400/35"
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
} satisfies Meta<typeof ReaderAnnotationMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A tapped yellow mark: recolor swatches, note, copy, ask-AI, plugin actions, remove. */
export const YellowHighlight: Story = {};

/** The ring follows the mark's current colour — here the pink swatch is active. */
export const PinkHighlight: Story = {
  args: { activeColor: "pink" },
};
