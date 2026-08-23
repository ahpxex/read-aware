import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { SettingsGroup } from "./SettingsGroup";
import { AIConfigPanel } from "./AIConfigPanel";

/**
 * The BYOK connection form: provider, key, model, and the advanced block a
 * hosting panel may extend.
 *
 * It renders against this Storybook origin's own stored settings, so it starts
 * unconfigured and the fields write through as you type. The "Test" button is
 * the only live network call in the whole component, and it is user-triggered.
 * Subscription state comes from the relay, which Storybook cannot reach — the
 * account rows therefore show the signed-out shape.
 */
const meta = {
  title: "Interface/Settings/AIConfigPanel",
  component: AIConfigPanel,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AIConfigPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Unconfigured: pick a provider, paste a key, choose a model. */
export const Default: Story = {};

/** The advanced block expanded. */
export const AdvancedExpanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Advanced settings" }));
  },
};

/** A custom OpenAI-compatible endpoint, which reveals the base-URL fields. */
export const CustomProvider: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox", { name: "AI Provider" }));
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole("option", {
        name: "Custom (OpenAI-compatible)",
      }),
    );
  },
};

/** With extra advanced content injected by the hosting panel. */
export const WithHostAdvancedContent: Story = {
  args: {
    advancedContent: (
      <SettingsGroup title="From the hosting panel">
        <p className="text-sm text-fg-muted">
          Sections the AI settings page folds into the advanced block.
        </p>
      </SettingsGroup>
    ),
  },
  play: AdvancedExpanded.play,
};
