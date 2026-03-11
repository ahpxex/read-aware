import type { Meta, StoryObj } from "@storybook/react-vite";
import { EpubReaderView } from "./EpubReaderView";
import demoEpubUrl from "../../../../demo/ElonMusk.epub?url";

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
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EpubReaderView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    initialEpubUrl: demoEpubUrl,
  },
};

export const FromShelfSelection: Story = {
  args: {
    selectedBook: sampleBook,
    initialEpubUrl: demoEpubUrl,
  },
};
