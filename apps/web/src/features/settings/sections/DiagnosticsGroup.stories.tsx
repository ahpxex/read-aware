import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsPage } from "../components/SettingsPage";
import { DiagnosticsGroup } from "./DiagnosticsGroup";

/**
 * Settings → About → Diagnostics: export the bundle to a file, or send it to
 * the developers through the relay.
 *
 * Both are behind an explicit user action, and the report additionally behind a
 * preview-and-confirm dialog — the app never uploads anything on its own, and
 * this group is the entire reporting surface. Assembling a bundle reads the log
 * files over Tauri IPC, so in Storybook the actions surface their failure toast
 * rather than opening the preview; the rows, their wording and the disabled
 * states are what these stories cover.
 *
 * The log-folder row is desktop-only and therefore absent here.
 */
const meta = {
  title: "Interface/Settings/DiagnosticsGroup",
  component: DiagnosticsGroup,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <SettingsPage title="About">
        <Story />
      </SettingsPage>
    ),
  ],
} satisfies Meta<typeof DiagnosticsGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The group at rest: two rows, each with its own explicit action. */
export const Default: Story = {};
