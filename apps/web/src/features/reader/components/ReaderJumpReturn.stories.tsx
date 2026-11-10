import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReaderJumpReturn } from "./ReaderJumpReturn";

/**
 * The way back offered after a jump in the open book — from a search hit, a
 * note, the contents, a link or the progress bar. It floats over the bottom
 * of the page until taken or dismissed.
 */
const meta = {
  title: "Interface/Reader/ReaderJumpReturn",
  component: ReaderJumpReturn,
  parameters: { layout: "centered" },
  args: { page: 98, onBack: () => {}, onDismiss: () => {} },
} satisfies Meta<typeof ReaderJumpReturn>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The book has pages: the control names the one the reader left. */
export const ToPage: Story = {};

/** No page to name (the book reports no page count). */
export const WithoutPage: Story = { args: { page: null } };
