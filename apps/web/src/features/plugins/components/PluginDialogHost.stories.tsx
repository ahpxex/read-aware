import type { Meta, StoryObj } from "@storybook/react-vite";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { PluginDialogRequest } from "../state/plugin-store";
import { pluginDialogAtom } from "../state/plugin-store";
import { PluginDialogHost } from "./PluginDialogHost";
import { everyBlockKind, sampleActions, sampleMetadata } from "./plugin.fixtures";

const request = (view: PluginDialogRequest["view"]): PluginDialogRequest => ({
  requestId: "req-1",
  pluginId: "dictionary",
  pluginName: "Dictionary",
  view,
});

/** Seeds one pending dialog request. */
const pending = (view: PluginDialogRequest["view"]) =>
  withAtoms(seed(pluginDialogAtom, request(view)));

/**
 * The single modal container for plugin views raised by selection actions and
 * palette commands. The dialog's own title names the owning plugin — provenance
 * stays visible no matter what the view renders inside it.
 */
const meta = {
  title: "Interface/Plugins/PluginDialogHost",
  component: PluginDialogHost,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PluginDialogHost>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A detail view, the common result of a selection action. */
export const DetailView: Story = {
  decorators: [
    pending({
      kind: "detail",
      title: "waxwing",
      content: [
        {
          kind: "dictionary",
          entry: {
            headword: "waxwing",
            pronunciation: "/ˈwakswɪŋ/",
            senses: [
              {
                partOfSpeech: "noun",
                definition:
                  "A crested passerine bird with waxy red tips on its wing feathers.",
                examples: ["I was the shadow of the waxwing slain."],
              },
            ],
          },
        },
      ],
      metadata: sampleMetadata,
      actions: sampleActions,
    }),
  ],
};

/** A list view opened in the dialog rather than pushed onto a page. */
export const ListView: Story = {
  decorators: [
    pending({
      kind: "list",
      title: "Saved words",
      items: Array.from({ length: 8 }, (_, i) => ({
        id: `w${i}`,
        title: `Entry ${i + 1}`,
        subtitle: "Saved from Pale Fire",
      })),
    }),
  ],
};

/** A form view — the dialog gets a fixed footer for the submit action. */
export const FormView: Story = {
  decorators: [
    pending({
      kind: "form",
      title: "Add a word",
      fields: [
        { kind: "text", id: "word", label: "Word", value: "iridule" },
        { kind: "textarea", id: "note", label: "Note", rows: 3 },
      ],
      submitLabel: "Save",
      onSubmit: () => undefined,
    }),
  ],
};

/**
 * The loading state: a selection action with `presentation: "dialog"` opens the
 * dialog immediately, before its view resolves, so the click feels answered.
 */
export const AwaitingView: Story = {
  decorators: [pending(null)],
};

/** Long content scrolls inside the height cap instead of growing the dialog. */
export const LongContentScrolls: Story = {
  decorators: [
    pending({
      kind: "detail",
      title: "A long entry",
      content: [...everyBlockKind, ...everyBlockKind],
      actions: sampleActions,
    }),
  ],
};

/** Nothing pending: the host renders a closed dialog. */
export const Closed: Story = {
  decorators: [withAtoms(seed(pluginDialogAtom, null))],
};
