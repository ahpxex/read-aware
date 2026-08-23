import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PluginFormField } from "../lib/plugin-types";
import { PluginFormViewBody } from "./PluginFormViewBody";
import { noopRunner } from "./plugin.fixtures";

/** One field of every kind the contract allows. */
const everyFieldKind: PluginFormField[] = [
  { kind: "text", id: "endpoint", label: "Endpoint", value: "https://api.example.com", inputMode: "url", helperText: "Where the plugin sends its requests." },
  { kind: "textarea", id: "prompt", label: "Prompt template", value: "Explain {{word}} in one sentence.", rows: 3 },
  { kind: "number", id: "limit", label: "Entries per page", value: 25, min: 5, max: 100, step: 5 },
  {
    kind: "select",
    id: "voice",
    label: "Voice",
    value: "aria",
    options: [
      { value: "aria", label: "Aria" },
      { value: "brook", label: "Brook" },
      { value: "cedar", label: "Cedar" },
    ],
  },
  {
    kind: "choice",
    id: "density",
    label: "Density",
    value: "comfortable",
    options: [
      { value: "compact", label: "Compact", icon: "rows" },
      { value: "comfortable", label: "Comfortable", icon: "cards" },
    ],
  },
  { kind: "toggle", id: "autoSave", label: "Save words automatically", description: "Adds every lookup to the notebook.", value: true },
  { kind: "checkbox", id: "notify", label: "Notify on new entries", value: false },
  { kind: "secret", id: "api_key", label: "API key", helperText: "Stored encrypted; never shown again once saved." },
];

/**
 * The host's rendering of a plugin-declared form — every widget is a design
 * system control, chosen by the field's `kind`. Plugins declare fields and a
 * submit handler; they never ship inputs.
 */
const meta = {
  title: "Interface/Plugins/PluginFormViewBody",
  component: PluginFormViewBody,
  parameters: { layout: "padded" },
  args: { busy: false, onResult: noopRunner },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginFormViewBody>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every field kind, with an explicit submit button. */
export const EveryFieldKind: Story = {
  args: {
    view: {
      kind: "form",
      title: "Plugin settings",
      fields: everyFieldKind,
      submitLabel: "Save settings",
      onSubmit: () => undefined,
    },
  },
};

/**
 * `submitMode: "change"` — the settings shape. Each edit writes through, so
 * there is no submit button at all.
 */
export const WriteThroughSettings: Story = {
  args: {
    view: {
      kind: "form",
      title: "Reading",
      submitMode: "change",
      fields: [
        { kind: "toggle", id: "autoSave", label: "Save words automatically", value: true },
        { kind: "number", id: "limit", label: "Entries per page", value: 25 },
      ],
      onSubmit: () => undefined,
    },
  },
};

/**
 * `visibleWhen` gates rendering only: switching the provider hides the other
 * provider's fields while their values stay in form state.
 */
export const ConditionalFields: Story = {
  args: {
    view: {
      kind: "form",
      title: "Speech",
      fields: [
        {
          kind: "choice",
          id: "provider",
          label: "Provider",
          value: "system",
          options: [
            { value: "system", label: "System voices" },
            { value: "cloud", label: "Cloud" },
          ],
        },
        {
          kind: "select",
          id: "systemVoice",
          label: "System voice",
          value: "aria",
          options: [
            { value: "aria", label: "Aria" },
            { value: "brook", label: "Brook" },
          ],
          visibleWhen: { field: "provider", equals: "system" },
        },
        {
          kind: "secret",
          id: "cloud_key",
          label: "Cloud API key",
          visibleWhen: { field: "provider", equals: "cloud" },
        },
      ],
      onSubmit: () => undefined,
    },
  },
};

/** A password-mode text field, which the agent catalog also hides. */
export const PasswordField: Story = {
  args: {
    view: {
      kind: "form",
      fields: [
        { kind: "text", id: "token", label: "Access token", inputMode: "password", helperText: "Prefer a secret field for real credentials." },
      ],
      onSubmit: () => undefined,
    },
  },
};

/**
 * A select declaring `dynamicOptions` with no resolver wired: the host must
 * fall back to a free text input rather than locking the user out of typing
 * the value.
 */
export const DynamicOptionsWithoutSource: Story = {
  args: {
    view: {
      kind: "form",
      fields: [
        {
          kind: "select",
          id: "voice",
          label: "Voice",
          value: "",
          options: [],
          dynamicOptions: true,
          helperText: "Listed from your account once the endpoint answers.",
        },
      ],
      onSubmit: () => undefined,
    },
  },
};

/** Helper text on every field, to check the vertical rhythm holds. */
export const WithHelperText: Story = {
  args: {
    view: {
      kind: "form",
      fields: everyFieldKind.map((field) =>
        "helperText" in field ? { ...field, helperText: "A line of guidance under the field." } : field,
      ),
      onSubmit: () => undefined,
    },
  },
};

/** Submitting: every control is disabled until the result settles. */
export const Busy: Story = {
  args: {
    busy: true,
    view: { kind: "form", title: "Plugin settings", fields: everyFieldKind, onSubmit: () => undefined },
  },
};

/** A form with no fields still renders its title and submit affordance. */
export const NoFields: Story = {
  args: { view: { kind: "form", title: "Nothing to configure", fields: [], onSubmit: () => undefined } },
};
