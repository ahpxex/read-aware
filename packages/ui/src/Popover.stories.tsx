import type { Meta, StoryObj } from "@storybook/react-vite";
import { Popover } from "./Popover";
import { Button } from "./Button";

const meta = {
  title: "Design System/Components/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    trigger: (
      <Button variant="outline" size="sm">
        Info
      </Button>
    ),
    children: (
      <div className="text-sm text-fg-muted">
        <p className="mb-1 font-medium text-fg">Reading stats</p>
        <p>You have read 12 books this year.</p>
      </div>
    ),
  },
};

export const RightAligned: Story = {
  render: (args) => (
    <div className="flex justify-end">
      <Popover {...args} />
    </div>
  ),
  args: {
    trigger: (
      <Button variant="outline" size="sm">
        Details
      </Button>
    ),
    children: <p className="text-sm text-fg-muted">Additional context goes here.</p>,
    align: "right",
  },
};

export const CenterAligned: Story = {
  render: (args) => (
    <div className="flex justify-center">
      <Popover {...args} />
    </div>
  ),
  args: {
    trigger: (
      <Button variant="ghost" size="sm">
        Help
      </Button>
    ),
    children: <p className="text-sm text-fg-muted">Click any item to view its details.</p>,
    align: "center",
  },
};

/** Opens upward, for triggers docked at the bottom of the screen. */
export const OpensUpward: Story = {
  render: (args) => (
    <div className="flex h-72 items-end">
      <Popover {...args} />
    </div>
  ),
  args: {
    trigger: (
      <Button variant="outline" size="sm">
        Appearance
      </Button>
    ),
    children: <p className="text-sm text-fg-muted">The panel opens above its trigger.</p>,
    side: "top",
  },
};

/**
 * Default `side="auto"`: the same trigger near the viewport's bottom edge
 * flips upward on its own because the content cannot fit below.
 */
export const AutoFlipsUpward: Story = {
  render: (args) => (
    <div className="flex h-[26rem] items-end">
      <Popover {...args} />
    </div>
  ),
  args: {
    trigger: (
      <Button variant="outline" size="sm">
        More
      </Button>
    ),
    children: (
      <ul className="flex flex-col text-sm">
        {Array.from({ length: 12 }, (_, index) => (
          <li key={index} className="rounded-md px-2 py-1.5">
            Menu item {index + 1}
          </li>
        ))}
      </ul>
    ),
  },
};
