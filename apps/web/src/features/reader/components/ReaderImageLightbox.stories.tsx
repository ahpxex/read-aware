import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReaderImageLightbox } from "./ReaderImageLightbox";

// A generated plate stands in for a book illustration: the viewer only ever
// sees a URL, so a data URL keeps the story self-contained.
const plate = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
    <rect width="900" height="600" fill="#efe9dc"/>
    <circle cx="450" cy="260" r="150" fill="none" stroke="#57534e" stroke-width="3"/>
    <path d="M150 520 Q 450 380 750 520" fill="none" stroke="#57534e" stroke-width="3"/>
    <text x="450" y="270" text-anchor="middle" font-family="serif" font-size="28" fill="#44403c">Plate I</text>
  </svg>`,
)}`;

const meta = {
  title: "Interface/Reader/ReaderImageLightbox",
  component: ReaderImageLightbox,
  parameters: { layout: "fullscreen" },
  args: {
    src: plate,
    alt: "Plate I — the voyage, as recorded in the ship's log",
    onClose: () => {},
  },
} satisfies Meta<typeof ReaderImageLightbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutCaption: Story = {
  args: { alt: null },
};
