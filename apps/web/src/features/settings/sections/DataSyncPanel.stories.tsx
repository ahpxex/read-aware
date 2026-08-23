import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { DataSyncPanel } from "./DataSyncPanel";

/**
 * Settings → Data & Sync: the account group, where the data lives, backup
 * import/export, and the danger zone.
 *
 * The Sync group at the top comes from the live scheduler and the relay, so in
 * Storybook it shows its web-shell placeholder — `SyncAccountGroup`'s own
 * stories cover the connected states. Everything else here is real: export
 * writes a file, import reads one, and the delete ritual arms exactly as it
 * does in the app.
 */
const meta = {
  title: "Interface/Settings/DataSyncPanel",
  component: DataSyncPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DataSyncPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The panel at rest. */
export const Default: Story = {};

/**
 * The delete-everything confirmation. The button stays disabled until the
 * literal is typed — a safety ritual, deliberately the same word in every
 * locale.
 */
export const DeleteConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Delete all data" }));
  },
};

/** The same dialog with the phrase typed, which arms the destructive button. */
export const DeleteArmed: Story = {
  play: async (context) => {
    await DeleteConfirmation.play?.(context);
    const body = within(context.canvasElement.ownerDocument.body);
    await userEvent.type(body.getByRole("textbox"), "DELETE");
  },
};
