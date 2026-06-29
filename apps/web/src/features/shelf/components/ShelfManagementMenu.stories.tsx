import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShelfManagementMenu } from "./ShelfManagementMenu";

const meta = {
  title: "Features/Shelf/ShelfManagementMenu",
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
