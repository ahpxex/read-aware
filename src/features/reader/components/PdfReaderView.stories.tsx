import type { Meta, StoryObj } from "@storybook/react-vite";
import { PdfReaderView } from "./PdfReaderView";
import demoPdfUrl from "../../../../demo/dummy.pdf?url";

const sampleBook = {
  id: "reader-story-book",
  title: "Dummy PDF Document",
  author: "W3C",
  progress: 0,
};

const meta = {
  title: "Features/Reader/PdfReaderView",
  component: PdfReaderView,
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
} satisfies Meta<typeof PdfReaderView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pdf: Story = {
  args: {
    initialPdfUrl: demoPdfUrl,
  },
};

export const FromShelfSelection: Story = {
  args: {
    selectedBook: sampleBook,
  },
};
