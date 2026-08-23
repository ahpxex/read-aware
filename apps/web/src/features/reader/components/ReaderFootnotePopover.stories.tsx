import type { Meta, StoryObj } from "@storybook/react-vite";
import { BUILTIN_READER_PALETTES } from "../../settings/lib/reader-theme";
import { ReaderFootnotePopover } from "./ReaderFootnotePopover";

/** The book page's own colour, from the default reading theme — the reader
    takes its palette from the reading theme, never from an app token. */
const page = BUILTIN_READER_PALETTES.warm;

/**
 * A footnote read in place, beside the reference that raised it, instead of
 * jumping to the note's own location and losing the reader's place.
 *
 * It positions itself against an anchor rect in reader-root coordinates, so
 * these stories render it inside a page-sized box and vary that anchor —
 * including the corners, where the anchored-position hook has to flip the
 * panel to keep it on screen.
 */
const meta = {
  title: "Interface/Reader/ReaderFootnotePopover",
  component: ReaderFootnotePopover,
  parameters: { layout: "padded" },
  args: {
    anchorRect: { left: 180, top: 120, width: 8, height: 16 },
    label: "1",
    text: "Line 12: the waxwing. A bird of the genus Bombycilla; the reference recurs in the Commentary, where Kinbote insists on a Zemblan variety no ornithologist has recorded.",
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div
        className="relative h-[26rem] w-[36rem] overflow-hidden rounded-sm border border-border p-8 font-serif text-sm leading-7"
        style={{ backgroundColor: page.bg, color: page.text }}
      >
        <p>
          I was the shadow of the waxwing<sup>1</sup> slain by the false azure in
          the windowpane; I was the smudge of ashen fluff — and I lived on, flew
          on, in the reflected sky.
        </p>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderFootnotePopover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Anchored mid-page, the ordinary case. */
export const Default: Story = {};

/** A one-line note; the panel shrinks to its content rather than reserving height. */
export const ShortNote: Story = {
  args: { text: "See the Foreword.", label: "2" },
};

/** A long note scrolls inside the panel's height cap. */
export const LongNote: Story = {
  args: {
    label: "3",
    text: Array.from(
      { length: 8 },
      (_, i) =>
        `Paragraph ${i + 1} of an unusually discursive note, of the kind an editor with an agenda tends to write when the poem declines to say what he needs it to say.`,
    ).join("\n\n"),
  },
};

/** A non-numeric marker — daggers and letters are as common as numbers. */
export const SymbolLabel: Story = {
  args: { label: "†" },
};

/** Anchored near the right edge, where the panel has to flip to stay on screen. */
export const AnchoredNearRightEdge: Story = {
  args: { anchorRect: { left: 540, top: 100, width: 8, height: 16 } },
};

/** Anchored near the bottom, where it has to open upward. */
export const AnchoredNearBottom: Story = {
  args: { anchorRect: { left: 200, top: 380, width: 8, height: 16 } },
};

/** No anchor rect: the panel still has to land somewhere sensible. */
export const WithoutAnchor: Story = {
  args: { anchorRect: null },
};
