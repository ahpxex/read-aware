import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@read-aware/ui";
import { userEvent, within } from "storybook/test";
import { showPluginToast } from "../lib/plugin-toast";
import { PluginToastBridge } from "./PluginToastBridge";

/**
 * The bridge renders nothing — it hands the live toast dispatcher to a
 * module-level handle so plugin code, which runs outside React (in a Worker,
 * behind a scheduler), can still raise a notice.
 *
 * A story of the component alone would therefore be a blank frame, so these
 * stories exercise the behaviour instead: mount the bridge and call
 * `showPluginToast` the way plugin code does. (The ToastProvider it needs is
 * global — the preview supplies it, as the app root does.)
 */
const meta = {
  title: "Interface/Plugins/PluginToastBridge",
  component: PluginToastBridge,
  parameters: { layout: "centered" },
} satisfies Meta<typeof PluginToastBridge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Press the button to raise a toast the way non-React plugin code does. */
export const RaisesAToast: Story = {
  render: () => (
    <>
      <PluginToastBridge />
      <Button onClick={() => showPluginToast("Dictionary: 12 entries imported.")}>
        Call showPluginToast()
      </Button>
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Call showPluginToast()" }));
  },
};

/**
 * Without the bridge mounted the handler is unset, so the same call is a no-op
 * rather than a crash — plugin code must never depend on a mounted host.
 */
export const NoBridgeMounted: Story = {
  render: () => (
    <Button onClick={() => showPluginToast("This notice has nowhere to go.")}>
      Call showPluginToast() with no bridge
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Call showPluginToast() with no bridge" }),
    );
  },
};
