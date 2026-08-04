import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrimaryNavigation } from "./PrimaryNavigation";

const meta = {
  title: "Interface/Navigation/PrimaryNavigation",
  component: PrimaryNavigation,
  args: {
    activeSurface: "shelf",
    onNavigate: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="relative h-12 w-[32rem] border-b border-border bg-[var(--ra-main-surface-color)]">
        <div className="absolute left-1/2 top-0 -translate-x-1/2">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof PrimaryNavigation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LibraryActive: Story = {};

export const AgentActive: Story = {
  args: { activeSurface: "context" },
};

export const Compact: Story = {
  args: { compact: true },
};
