import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { AIPanel } from "./AIPanel";

const meta = {
  title: "Interface/Settings/AIPanel",
  component: AIPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AIPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The AI section on jotai defaults: unconfigured BYOK connection form, all
    feature toggles on. Renders standalone — the connection "Test" button is the
    only live call, and it's user-triggered. Note: toggles write through
    `aiPreferencesAtom` (and Save writes the config) to this Storybook origin's
    localStorage. */
export const Default: Story = {};

export const AdvancedSettings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Advanced settings" }),
    );
  },
};

export const SeparateFastModel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Advanced settings" }),
    );
    await userEvent.click(
      canvas.getByRole("switch", { name: "Use a separate Fast model" }),
    );
  },
};

export const CustomProvider: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("combobox", { name: "AI Provider" }),
    );
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole("option", {
        name: "Custom (OpenAI-compatible)",
      }),
    );
  },
};

export const CustomAdvancedSettings: Story = {
  play: async (context) => {
    await CustomProvider.play?.(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Advanced settings" }),
    );
  },
};
