import type { Meta, StoryObj } from "@storybook/react-vite";
import { PluginDetailViewBody } from "./PluginDetailViewBody";
import {
  everyBlockKind,
  noopRunner,
  sampleActions,
  sampleControls,
  sampleMetadata,
} from "./plugin.fixtures";

/**
 * A plugin's detail view: content blocks with optional controls, actions and
 * metadata. The host arranges them differently depending on the surface — a
 * page keeps actions and metadata in the footer, a dialog lifts actions into
 * its fixed footer and metadata under the heading — so both arrangements have
 * stories here.
 *
 * A leading `dictionary` block is special-cased: its headword becomes the
 * detail's heading rather than sitting in the body.
 */
const meta = {
  title: "Interface/Plugins/PluginDetailViewBody",
  component: PluginDetailViewBody,
  parameters: { layout: "padded" },
  args: { stackDepth: 0, busy: false, onResult: noopRunner },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginDetailViewBody>;

export default meta;
type Story = StoryObj<typeof meta>;

const fullView = {
  kind: "detail",
  title: "Vocabulary entry",
  content: everyBlockKind,
  metadata: sampleMetadata,
  controls: sampleControls,
  actions: sampleActions,
} as const;

/** The page arrangement: actions and metadata in the footer. */
export const Default: Story = {
  args: { view: fullView },
};

/** The dialog arrangement: metadata under the heading, actions hoisted out. */
export const DialogArrangement: Story = {
  args: { view: fullView, showActions: false, metadataPresentation: "header" },
};

/** Content only — no controls, actions or metadata declared. */
export const ContentOnly: Story = {
  args: {
    view: {
      kind: "detail",
      title: "Just content",
      content: [
        { kind: "text", text: "A detail view can be nothing but prose." },
        { kind: "markdown", markdown: "With **markdown** if the plugin prefers." },
      ],
    },
  },
};

/** Controls without actions, the shape a filtered list header uses. */
export const ControlsOnly: Story = {
  args: {
    view: {
      kind: "detail",
      title: "Saved words",
      content: [{ kind: "text", text: "Sorted and scoped by the controls above." }],
      controls: sampleControls,
    },
  },
};

/** Metadata without actions — provenance for a read-only entry. */
export const MetadataOnly: Story = {
  args: {
    view: {
      kind: "detail",
      title: "Where this came from",
      content: [{ kind: "text", text: "An entry imported from an external source." }],
      metadata: sampleMetadata,
    },
  },
};

/**
 * A leading dictionary block: the headword and pronunciation become the
 * heading, and the entry body renders with the app's own dictionary UX.
 */
export const DictionaryHeading: Story = {
  args: {
    view: {
      kind: "detail",
      content: [
        {
          kind: "dictionary",
          entry: {
            headword: "iridule",
            pronunciation: "/ˈɪrɪdjuːl/",
            senses: [
              {
                partOfSpeech: "noun",
                definition: "An iridescent cloudlet — a coinage of Nabokov's.",
                examples: ["...a rare phenomenon, an iridule."],
              },
            ],
          },
        },
        { kind: "divider" },
        { kind: "text", text: "Saved from Pale Fire, line 109.", tone: "muted" },
      ],
      metadata: sampleMetadata,
      actions: sampleActions,
    },
  },
};

/** No title: the detail opens straight into its content. */
export const Untitled: Story = {
  args: { view: { kind: "detail", content: everyBlockKind.slice(0, 4) } },
};

/**
 * `scrollBody`: the heading stays fixed and only the body scrolls — how a
 * dialog host bounds a long entry.
 */
export const ScrollingBody: Story = {
  args: {
    scrollBody: true,
    view: {
      kind: "detail",
      title: "A long entry",
      content: [...everyBlockKind, ...everyBlockKind, ...everyBlockKind],
      actions: sampleActions,
    },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto flex h-[28rem] max-w-2xl flex-col rounded-md border border-border p-4">
        <Story />
      </div>
    ),
  ],
};

/** While a result runs, controls and actions disable; content stays readable. */
export const Busy: Story = {
  args: { view: fullView, busy: true },
};

/** An empty content array still renders the heading and its actions. */
export const NoContent: Story = {
  args: { view: { kind: "detail", title: "Nothing yet", content: [], actions: sampleActions } },
};
