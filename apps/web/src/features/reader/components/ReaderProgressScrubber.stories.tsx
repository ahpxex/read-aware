import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReaderProgressScrubber } from "./ReaderProgressScrubber";

const marks = [
  { fraction: 0, label: "Cover" },
  { fraction: 0.06, label: "Introduction" },
  { fraction: 0.21, label: "1. The Shape of a Reading Trace" },
  { fraction: 0.44, label: "2. Memory, Not Transcript" },
  { fraction: 0.68, label: "3. Retrieval Without Vectors" },
  { fraction: 0.9, label: "Afterword" },
];

const meta = {
  title: "Interface/Reader/ReaderProgressScrubber",
  component: ReaderProgressScrubber,
  parameters: { layout: "fullscreen" },
  args: {
    fraction: 0.37,
    totalPages: 412,
    marks,
    onSeek: () => {},
  },
  decorators: [
    (Story) => (
      // Stands in for the reader header: the bar merges into its bottom edge,
      // and the readout floats up over the title band.
      <div className="relative h-12 w-full bg-fill">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderProgressScrubber>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: the hairline it has always been. Hover it to scrub. */
export const Default: Story = {};

/** A book that reports no page count — the readout falls back to a percentage. */
export const WithoutPageCount: Story = {
  args: { totalPages: 0 },
};

/** No chapter fractions resolved (e.g. PDF): ticks and labels simply absent. */
export const WithoutChapterMarks: Story = {
  args: { marks: [] },
};

/** Nothing to seek in yet — the bar stays an inert hairline. */
export const Inert: Story = {
  args: { fraction: null, onSeek: undefined },
};
