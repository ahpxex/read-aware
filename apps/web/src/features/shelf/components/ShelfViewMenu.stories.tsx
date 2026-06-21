import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShelfViewMenu } from "./ShelfViewMenu";

const meta = {
  title: "Features/Shelf/ShelfViewMenu",
  component: ShelfViewMenu,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex h-80 w-[28rem] items-start justify-end p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShelfViewMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click the slider icon to open the view menu (layout / grouping / sorting).
 *  State is persisted to localStorage, so it is shared with the live shelf. */
export const Default: Story = {};
