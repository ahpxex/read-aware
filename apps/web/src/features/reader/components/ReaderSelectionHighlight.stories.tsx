import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReaderSelectionState } from "../lib/selection-overlay";
import { BUILTIN_READER_PALETTES } from "../../settings/lib/reader-theme";
import { ReaderSelectionHighlight } from "./ReaderSelectionHighlight";

/** The book page's own colour, from the default reading theme — the reader
    takes its palette from the reading theme, never from an app token. */
const page = BUILTIN_READER_PALETTES.warm;

/** A run of line rects, as the engine reports them for a multi-line selection. */
function lines(count: number, top = 40, width = 380): ReaderSelectionState["rects"] {
  return Array.from({ length: count }, (_, i) => ({
    left: i === 0 ? 60 : 24,
    top: top + i * 28,
    width: i === count - 1 ? width * 0.55 : width,
    height: 20,
  }));
}

function selection(rects: ReaderSelectionState["rects"]): ReaderSelectionState {
  return {
    anchorRect: rects[0] ?? null,
    appearance: "selection",
    cfiRange: "epubcfi(/6/14!/4/2/2,/1:0,/1:34)",
    chapterHref: "chapter-1.xhtml",
    rects,
    text: "I was the shadow of the waxwing slain",
  };
}

/**
 * The self-drawn selection tint.
 *
 * iOS stacks its native selection menu on top of the app's own, so the reader
 * clears the native selection the moment it captures one — which also takes the
 * native blue tint with it. This layer paints it back from the rects captured at
 * that moment. It is deliberately a static snapshot: any scroll or page turn
 * clears the selection anyway.
 */
const meta = {
  title: "Interface/Reader/ReaderSelectionHighlight",
  component: ReaderSelectionHighlight,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div
        className="relative h-64 w-[28rem] overflow-hidden rounded-sm border border-border p-6 font-serif text-sm leading-[28px]"
        style={{ backgroundColor: page.bg, color: page.text }}
      >
        <p>
          I was the shadow of the waxwing slain by the false azure in the
          windowpane; I was the smudge of ashen fluff — and I lived on, flew on,
          in the reflected sky.
        </p>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderSelectionHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A selection spanning three lines, the shape a sentence usually takes. */
export const MultiLine: Story = {
  args: { selection: selection(lines(3)) },
};

/** A few words on one line. */
export const SingleLine: Story = {
  args: { selection: selection([{ left: 60, top: 40, width: 180, height: 20 }]) },
};

/** A long passage: many line rects, all painted from the one snapshot. */
export const LongPassage: Story = {
  args: { selection: selection(lines(6)) },
};

/** No selection: the layer renders nothing and never blocks pointer events. */
export const NoSelection: Story = {
  args: { selection: null },
};

/** A selection captured with no rects — nothing to paint, and no empty box. */
export const NoRects: Story = {
  args: { selection: selection([]) },
};
