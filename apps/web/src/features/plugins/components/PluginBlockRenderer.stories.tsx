import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PluginBlock } from "../lib/plugin-types";
import { PluginBlocks } from "./PluginBlockRenderer";
import { everyBlockKind, noopRunner, sampleActions } from "./plugin.fixtures";

/**
 * The host's block renderer — the whole of what a plugin can put on screen.
 * A plugin declares semantic blocks; every typographic and spacing decision is
 * made here, against the design system. These stories are the visual contract
 * for that vocabulary, so each block kind appears at least once.
 */
const meta = {
  title: "Interface/Plugins/PluginBlockRenderer",
  component: PluginBlocks,
  parameters: { layout: "padded" },
  args: { stackDepth: 0, busy: false, onResult: noopRunner },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginBlocks>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every simple block kind in one sequence, in declaration order. */
export const EveryBlockKind: Story = {
  args: { blocks: everyBlockKind },
};

/** Text variants and tones — the full range of emphasis a plugin may request. */
export const TextVariants: Story = {
  args: {
    blocks: [
      { kind: "text", text: "Heading variant", variant: "heading" },
      { kind: "text", text: "EYEBROW VARIANT", variant: "eyebrow" },
      { kind: "text", text: "Body variant, the default.", variant: "body" },
      { kind: "text", text: "Caption variant", variant: "caption" },
      { kind: "text", text: "Body, muted tone", tone: "muted" },
      { kind: "text", text: "Body, subtle tone", tone: "subtle" },
    ],
  },
};

/** Markdown goes through the app's own renderer, links and code included. */
export const Markdown: Story = {
  args: {
    blocks: [
      {
        kind: "markdown",
        markdown:
          "## From the feed\n\nA paragraph with **bold**, *italic*, `inline code` and a [link](https://example.com).\n\n- first item\n- second item\n\n> A block quote.",
      },
    ],
  },
};

/** Alerts, in each variant the contract allows. */
export const Alerts: Story = {
  args: {
    blocks: [
      { kind: "alert", title: "Heads up", message: "Three entries are waiting to upload.", variant: "default" },
      { kind: "alert", title: "Couldn't reach the feed", message: "The last refresh failed.", variant: "destructive" },
      { kind: "alert", title: "Imported", message: "42 entries added to your notebook.", variant: "success" },
      { kind: "alert", message: "An alert with no title at all." },
    ],
  },
};

/** Key/value rows in both layouts and across column counts. */
export const KeyValueLayouts: Story = {
  args: {
    blocks: [
      {
        kind: "keyValue",
        layout: "inline",
        rows: [
          { label: "Book", value: "Pale Fire" },
          { label: "Saved", value: "12 June 2026" },
        ],
      },
      { kind: "divider" },
      {
        kind: "keyValue",
        layout: "stacked",
        columns: 2,
        rows: [
          { label: "Source", value: "Wiktionary" },
          { label: "License", value: "CC BY-SA 4.0" },
          { label: "Language", value: "English" },
          { label: "Reviewed", value: "18 times" },
        ],
      },
    ],
  },
};

/** Sections and groups: the two ways a plugin nests blocks. */
export const SectionsAndGroups: Story = {
  args: {
    blocks: [
      {
        kind: "section",
        title: "Today",
        description: "Entries saved in the last 24 hours.",
        gap: "tight",
        blocks: [
          { kind: "text", text: "waxwing", variant: "heading" },
          { kind: "text", text: "A crested passerine bird.", tone: "muted" },
        ],
      },
      {
        kind: "group",
        gap: "relaxed",
        blocks: [
          { kind: "metric", label: "Streak", value: "12 days" },
          { kind: "progress", value: 40, label: "Weekly goal", showValue: true },
        ],
      },
    ],
  },
};

/** Columns, with weights and a minimum-width preset per cell. */
export const Columns: Story = {
  args: {
    blocks: [
      {
        kind: "columns",
        gap: "relaxed",
        align: "start",
        cells: [
          {
            weight: 2,
            blocks: [
              { kind: "text", text: "Commentary", variant: "heading" },
              { kind: "text", text: "The wider column carries the prose.", tone: "muted" },
            ],
          },
          {
            weight: 1,
            minWidth: "compact",
            blocks: [
              { kind: "metric", label: "Entries", value: "128" },
              { kind: "tags", values: ["poetry"] },
            ],
          },
        ],
      },
    ],
  },
};

/** The legacy single-block `row`, kept working for older plugins. */
export const LegacyRow: Story = {
  args: {
    blocks: [
      {
        kind: "row",
        align: "center",
        cells: [
          { weight: 2, block: { kind: "text", text: "A row cell" } },
          { weight: 1, block: { kind: "metric", label: "Count", value: "7" } },
        ],
      },
    ],
  },
};

/** Actions inside content, aligned both ways. */
export const ActionBlocks: Story = {
  args: {
    blocks: [
      { kind: "actions", actions: sampleActions, align: "start" },
      { kind: "divider" },
      { kind: "actions", actions: sampleActions, align: "end" },
    ],
  },
};

/** A dictionary entry, rendered with the app's own dictionary typography. */
export const DictionaryEntry: Story = {
  args: {
    blocks: [
      {
        kind: "dictionary",
        entry: {
          headword: "waxwing",
          pronunciation: "/ˈwakswɪŋ/",
          senses: [
            {
              partOfSpeech: "noun",
              definition:
                "A crested passerine bird with silky brown plumage and waxy red tips on the wing feathers.",
              examples: ["I was the shadow of the waxwing slain."],
            },
          ],
        },
      },
    ],
  },
};

/** The three gap presets, so their difference is visible side by side. */
export const GapPresets: Story = {
  render: (args) => (
    <div className="space-y-8">
      {(["tight", "normal", "relaxed"] as const).map((gap) => (
        <div key={gap}>
          <code className="mb-2 block text-[10px] text-fg-muted">gap: {gap}</code>
          <PluginBlocks
            {...args}
            gap={gap}
            blocks={
              [
                { kind: "text", text: "First line" },
                { kind: "text", text: "Second line" },
                { kind: "text", text: "Third line" },
              ] satisfies PluginBlock[]
            }
          />
        </div>
      ))}
    </div>
  ),
  args: { blocks: [] },
};

/** While a result runs, action blocks disable but content stays readable. */
export const Busy: Story = {
  args: { busy: true, blocks: [...everyBlockKind, { kind: "actions", actions: sampleActions }] },
};

/** Nothing declared: the renderer produces nothing, not an empty stack. */
export const NoBlocks: Story = {
  args: { blocks: [] },
};
