import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { ShelfManagementMenu } from "./ShelfManagementMenu";

const meta = {
  title: "Interface/Shelf/ShelfManagementMenu",
  component: ShelfManagementMenu,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex h-80 w-[28rem] items-start justify-end p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShelfManagementMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click the slider icon to open the management menu (layout / grouping / sorting).
 *  State is persisted to localStorage, so it is shared with the live shelf. */
export const Default: Story = {};

/** The open menu: layout, grouping, sorting, and the select-books entry point. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /shelf management/i }));
  },
};
