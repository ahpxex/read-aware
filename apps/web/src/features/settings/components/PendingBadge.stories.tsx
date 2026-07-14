import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@read-aware/ui";
import { PendingBadge } from "./PendingBadge";
import { SettingsRow } from "./SettingsRow";

const meta = {
  title: "Interface/Settings/PendingBadge",
  component: PendingBadge,
} satisfies Meta<typeof PendingBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default localized label: "Coming soon". */
export const Default: Story = {};

/** A custom short status in place of the default. */
export const CustomLabel: Story = {
  args: { children: "Desktop" },
};

/** In situ: next to a disabled action inside a settings row (the AI panel's
    stored-memory row). */
export const InSettingsRow: Story = {
  render: () => (
    <div className="mx-auto max-w-2xl">
      <SettingsRow
        borderless
        title="Stored memory"
        description="What the assistant has learned about your reading."
        control={
          <span className="flex items-center gap-2">
            <PendingBadge />
            <Button variant="outline" size="sm" disabled>
              Clear memory
            </Button>
          </span>
        }
      />
    </div>
  ),
};
