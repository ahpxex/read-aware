import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PluginView } from "../lib/plugin-types";
import { PluginViewRenderer } from "./PluginViewRenderer";

const dictionaryDetail: PluginView = {
  kind: "detail",
  content: [
    {
      kind: "dictionary",
      entry: {
        headword: "serendipity",
        pronunciation: "/ˌserənˈdipədē/",
        senses: [
          {
            partOfSpeech: "noun",
            definition: "The occurrence of a happy discovery by chance.",
            examples: ["A fortunate stroke of serendipity brought the book back to her."],
          },
        ],
        contextualMeaning: "An unexpected but welcome discovery while reading.",
      },
    },
    {
      kind: "quote",
      text: "There is something at work in my soul, which I do not understand.",
      caption: "Frankenstein",
    },
  ],
  metadata: [
    { kind: "label", label: "Book", value: "Frankenstein", icon: "book-open" },
    { kind: "label", label: "Added", value: "Jul 24, 2026", icon: "calendar" },
    { kind: "tags", label: "Themes", values: ["chance", "discovery"] },
  ],
  controls: [
    {
      kind: "select",
      id: "target-language",
      label: "Target language",
      value: "en",
      icon: "translate",
      options: [
        { value: "auto", label: "Match app language" },
        { value: "en", label: "English" },
        { value: "zh-Hans", label: "简体中文" },
      ],
      onChange: () => undefined,
    },
  ],
  actions: [
    {
      id: "remove",
      label: "Delete word",
      icon: "trash",
      variant: "danger",
      run: () => ({ toast: "Removed" }),
    },
  ],
};

const meta = {
  title: "Interface/Plugins/PluginViewRenderer",
  component: PluginViewRenderer,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PluginViewRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DictionaryDetail: Story = {
  args: { view: dictionaryDetail, className: "mx-auto max-w-5xl" },
};

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

export const DictionaryTimeline: Story = {
  args: {
    className: "mx-auto max-w-5xl",
    view: {
      kind: "list",
      searchable: true,
      searchPlaceholder: "Search saved words",
      timeline: true,
      actions: [
        {
          id: "export",
          label: "Export saved words",
          icon: "export",
          run: () => ({ toast: "Exported saved words" }),
        },
      ],
      items: [
        {
          id: "serendipity",
          title: "serendipity",
          subtitle: "(noun) The occurrence of a happy discovery by chance.",
          timestamp: daysAgo(0),
          presentation: "dialog",
          accessories: [{ kind: "text", text: "Frankenstein" }],
          onSelect: () => ({ view: dictionaryDetail }),
        },
        {
          id: "ephemeral",
          title: "ephemeral",
          subtitle: "(adjective) Lasting for a very short time.",
          timestamp: daysAgo(1),
          presentation: "dialog",
          accessories: [{ kind: "text", text: "Orlando" }],
          onSelect: () => ({ view: dictionaryDetail }),
        },
        {
          id: "liminal",
          title: "liminal",
          subtitle: "(adjective) At a boundary or transitional point.",
          timestamp: daysAgo(10),
          presentation: "dialog",
          accessories: [{ kind: "text", text: "The Waves" }],
          onSelect: () => ({ view: dictionaryDetail }),
        },
      ],
    },
  },
};

export const ComposedLayout: Story = {
  args: {
    className: "mx-auto max-w-5xl",
    view: {
      kind: "blocks",
      blocks: [
        {
          kind: "columns",
          cells: [
            { blocks: [{ kind: "metric", label: "Books", value: "12" }] },
            { blocks: [{ kind: "metric", label: "Saved words", value: "128" }] },
            { blocks: [{ kind: "metric", label: "Notes", value: "47" }] },
          ],
        },
        { kind: "divider" },
        {
          kind: "section",
          title: "Reading progress",
          blocks: [{ kind: "progress", value: 68, label: "Frankenstein", showValue: true }],
        },
      ],
    },
  },
};
