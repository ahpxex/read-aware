import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PrimaryDestination } from "../hooks/usePrimaryDestinations";
import { PrimaryNavigation } from "./PrimaryNavigation";

const defaultDestinations: PrimaryDestination[] = [
  { id: "core:library", topNav: "shelf", label: "Library" },
  { id: "core:agent", topNav: "context", label: "Agent" },
];

const meta = {
  title: "Interface/Navigation/PrimaryNavigation",
  component: PrimaryNavigation,
  args: {
    destinations: defaultDestinations,
    activeTopNav: "shelf",
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
  args: { activeTopNav: "context" },
};

export const Compact: Story = {
  args: { compact: true },
};

export const StatsPromoted: Story = {
  args: {
    destinations: [
      ...defaultDestinations,
      { id: "core:stats", topNav: "stats", label: "Reading stats" },
    ],
    activeTopNav: "stats",
  },
};
