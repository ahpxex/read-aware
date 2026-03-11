import type { Meta, StoryObj } from "@storybook/react-vite";
import { EpubReaderView } from "./EpubReaderView";

const sampleBook = {
  id: "reader-story-book",
  title: "The Master and Margarita",
  author: "Mikhail Bulgakov",
  progress: 64,
};

const meta = {
  title: "Features/Reader/EpubReaderView",
  component: EpubReaderView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof EpubReaderView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {},
};

export const FromShelfSelection: Story = {
  args: {
    selectedBook: sampleBook,
  },
};
