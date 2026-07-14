import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Toggle } from "@read-aware/ui";
import { PendingBadge } from "./PendingBadge";
import { SettingsRow } from "./SettingsRow";

const meta = {
  title: "Interface/Settings/SettingsRow",
  component: SettingsRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The canonical row: title + helper description with a trailing toggle. */
export const Default: Story = {
  args: {
    borderless: true,
    title: "Launch at startup",
    description: "Open ReadAware automatically when you sign in to this device.",
    control: <Toggle aria-label="Launch at startup" checked onChange={() => {}} />,
  },
};

/** Title only — the description line is omitted, the control stays trailing. */
export const WithoutDescription: Story = {
  args: {
    borderless: true,
    title: "Check spelling while typing",
    control: <Toggle aria-label="Check spelling while typing" checked={false} onChange={() => {}} />,
  },
};

/** A button control instead of a toggle, for one-shot actions. */
export const WithButtonControl: Story = {
  args: {
    borderless: true,
    title: "Check for updates",
    description: "You're on version 0.2.6.",
    control: (
      <Button variant="outline" size="sm" onClick={() => {}}>
        Check now
      </Button>
    ),
  },
};

/** A stack of rows with mixed controls: the first borderless, the rest divided
    by hairlines — the rhythm of a settings list. */
export const RowList: Story = {
  args: { title: "Launch at startup" },
  render: () => (
    <div>
      <SettingsRow
        borderless
        title="Launch at startup"
        description="Open ReadAware automatically when you sign in to this device."
        control={<Toggle aria-label="Launch at startup" checked onChange={() => {}} />}
      />
      <SettingsRow
        title="File associations"
        description="Open EPUB, MOBI, and PDF files with ReadAware by default."
        control={<Toggle aria-label="File associations" checked={false} onChange={() => {}} />}
      />
      <SettingsRow
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
