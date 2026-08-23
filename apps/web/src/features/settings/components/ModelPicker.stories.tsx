import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { userEvent, within } from "storybook/test";
import { PROVIDER_MODELS } from "../../ai/lib/ai-config";
import { ModelPicker } from "./ModelPicker";

/**
 * The searchable model selector.
 *
 * Two things shape it. The recommended subset is pinned to the top, with the
 * provider's full catalog searchable beneath it — and when a search matches
 * nothing, the typed text is offered as a model id verbatim. That escape hatch
 * is deliberate: a bundled catalog can never keep up with upstream releases,
 * and a picker that refuses an unknown id would lock users out of a model that
 * already works.
 */
const meta = {
  title: "Interface/Settings/ModelPicker",
  component: ModelPicker,
  parameters: { layout: "padded" },
  args: {
    label: "Model",
    provider: "anthropic",
    recommended: PROVIDER_MODELS.anthropic,
    value: PROVIDER_MODELS.anthropic[0]?.value ?? "",
    onChange: () => {},
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed, showing the current selection on the underline trigger. */
export const Closed: Story = {};

/** With helper text under the field. */
export const WithHelperText: Story = {
  args: { helperText: "Used for every reading turn unless a Fast model is set." },
};

/** Opened: the recommended subset on top, the full catalog below. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Model/ }));
  },
};

/** Filtering the catalog by name or id. */
export const Searching: Story = {
  play: async (context) => {
    await Open.play?.(context);
    const body = within(context.canvasElement.ownerDocument.body);
    await userEvent.type(body.getByRole("searchbox"), "haiku");
  },
};

/**
 * A query that matches nothing in the catalog. The picker offers to use the
 * text as a model id rather than dead-ending — the escape hatch for models
 * newer than the bundled catalog.
 */
export const NoMatchesOffersRawId: Story = {
  play: async (context) => {
    await Open.play?.(context);
    const body = within(context.canvasElement.ownerDocument.body);
    await userEvent.type(body.getByRole("searchbox"), "claude-opus-9-20990101");
  },
};

/** Another provider, whose catalog and price shape differ. */
export const OpenRouterProvider: Story = {
  args: {
    provider: "openrouter",
    recommended: PROVIDER_MODELS.openrouter,
    value: PROVIDER_MODELS.openrouter[0]?.value ?? "",
  },
};

/** A value the catalog has never heard of — kept selectable, shown verbatim. */
export const UnknownValueSelected: Story = {
  args: { value: "some-model-nobody-shipped-yet" },
};

/** Nothing selected yet. */
export const Unset: Story = {
  args: { value: "" },
};

/** Wired up, so a selection can actually be made and seen to stick. */
export const Interactive: Story = {
  render: function Interactive(args) {
    const [value, setValue] = useState(args.value);
    return (
      <>
        <ModelPicker {...args} value={value} onChange={setValue} />
        <p className="mt-3 text-xs text-fg-subtle">
          selected: <code>{value || "—"}</code>
        </p>
      </>
    );
  },
};
