import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppError, ERR_AI_NETWORK } from "@read-aware/core";
import type { CatalogModel } from "@read-aware/agent";
import { ModelPicker } from "./ModelPicker";

const models: CatalogModel[] = ["glm-example", "glm-example-fast", "glm-example-vision"].map((id) => ({
  id, name: id, provider: "zai-coding-cn", api: "openai-completions",
  baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
  reasoning: true, input: ["text"], contextWindow: 128_000, maxTokens: 8_192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}));
const catalog = { models, refreshing: false, checkedAt: 1_788_732_000_000, refresh: () => {} };
const meta = {
  title: "Interface/Settings/ModelPicker",
  component: ModelPicker,
  parameters: { layout: "padded" },
  args: { label: "Model", value: models[0].id, onChange: () => {}, catalog },
  decorators: [(Story) => <div className="max-w-sm"><Story /></div>],
} satisfies Meta<typeof ModelPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Model/ }));
    await expect(within(canvasElement.ownerDocument.body).getByRole("listbox")).toBeVisible();
  },
};
export const Searching: Story = {
  play: async (context) => {
    await Open.play?.(context);
    await userEvent.type(within(context.canvasElement.ownerDocument.body).getByRole("combobox"), "fast");
  },
};
export const UnknownValueSelected: Story = { args: { value: "previously-selected-model" } };
export const Loading: Story = { args: { catalog: { ...catalog, models: [], refreshing: true } } };
export const OfflineWithCache: Story = { args: { catalog: { ...catalog, error: new AppError(ERR_AI_NETWORK, "offline", { retryable: true }) } } };
export const NoCache: Story = { args: { value: "", catalog: { ...catalog, models: [], checkedAt: undefined } } };
export const Interactive: Story = {
  render: function Interactive(args) {
    const [value, setValue] = useState(args.value);
    return <ModelPicker {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: /Model/ });
    await userEvent.click(trigger);
    await userEvent.type(page.getByRole("combobox"), "fast");
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveTextContent("glm-example-fast");
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(page.queryByRole("listbox")).not.toBeInTheDocument());
    await expect(trigger).toHaveFocus();
  },
};
export const NearDialogBottom: Story = {
  decorators: [(Story) => (
    <div role="dialog" aria-label="Settings" className="fixed bottom-8 left-8 z-[60] h-64 w-80 overflow-hidden border border-border bg-paper p-4">
      <div className="h-36" /><Story />
    </div>
  )],
  play: async (context) => {
    await Open.play?.(context);
    const page = within(context.canvasElement.ownerDocument.body);
    const settings = page.getByRole("dialog", { name: "Settings" });
    const popup = page.getByRole("dialog", { name: "Model" });
    await expect(settings.contains(popup)).toBe(false);
    await waitFor(() => {
      const bounds = popup.getBoundingClientRect();
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    });
    await userEvent.keyboard("{Escape}");
    await expect(settings).toBeVisible();
  },
};
