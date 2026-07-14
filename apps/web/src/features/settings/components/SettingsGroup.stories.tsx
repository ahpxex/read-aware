import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChoiceGroup, Toggle } from "@read-aware/ui";
import { PendingBadge } from "./PendingBadge";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";

const meta = {
  title: "Interface/Settings/SettingsGroup",
  component: SettingsGroup,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A titled cluster of rows with controls — the standard settings composition. */
export const Default: Story = {
  args: {
    title: "Desktop integration",
    description: "How ReadAware behaves as an application on this device.",
    children: (
      <>
        <SettingsRow
          borderless
          title="Launch at startup"
          description="Open ReadAware automatically when you sign in."
          control={<Toggle aria-label="Launch at startup" checked onChange={() => {}} />}
        />
        <SettingsRow
          title="File associations"
          description="Open EPUB, MOBI, and PDF files with ReadAware by default."
          control={<Toggle aria-label="File associations" checked={false} onChange={() => {}} />}
        />
        <SettingsRow
          title="Automatic updates"
          description="Download and install updates in the background."
          control={<Toggle aria-label="Automatic updates" checked onChange={() => {}} />}
        />
      </>
    ),
  },
};

/** A status badge riding next to the title via `aside`, for not-yet-wired clusters. */
export const WithAside: Story = {
  args: {
    title: "Sync",
    aside: <PendingBadge />,
    children: (
      <SettingsRow
        borderless
        title="Sync across devices"
        description="Encrypt and relay your reading events to other devices."
        control={<Toggle aria-label="Sync across devices" checked={false} onChange={() => {}} />}
      />
    ),
  },
};

/** A group hosting a bare control cluster instead of rows (like the theme picker). */
export const WithChoiceControl: Story = {
  args: {
    title: "Theme",
    description: "How the app chrome is drawn. System follows the OS setting.",
    children: (
      <ChoiceGroup
        value="system"
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        onChange={() => {}}
      />
    ),
  },
};
