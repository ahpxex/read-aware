import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea } from "@read-aware/ui";
import type { Decorator } from "@storybook/react-vite";
import type { PluginListItem } from "../lib/plugin-types";
import { PluginListViewBody } from "./PluginListViewBody";
import { noopRunner, sampleActions } from "./plugin.fixtures";

const WORDS = [
  ["waxwing", "A crested passerine bird", ["bird", "poetry"]],
  ["shagreen", "Rough untanned leather", ["material"]],
  ["preterist", "One concerned with the past", ["philosophy"]],
  ["iridule", "An iridescent cloudlet", ["nabokov", "coinage"]],
  ["stillicide", "A falling of drops of water", ["archaic"]],
  ["lemniscate", "A figure-eight curve", ["mathematics"]],
] as const;

/** Timestamps spread across today, this week and this month, for the tabs. */
const HOURS_AGO = [1, 5, 30, 100, 400, 900];
const BASE = Date.UTC(2026, 5, 28, 20, 0);

function item(index: number): PluginListItem {
  const [title, subtitle, keywords] = WORDS[index % WORDS.length];
  return {
    id: `w${index}`,
    title,
    subtitle,
    timestamp: new Date(BASE - HOURS_AGO[index % HOURS_AGO.length] * 3_600_000).toISOString(),
    icon: "notebook",
    keywords: [...keywords],
    accessories: [
      { kind: "text", text: `${(index % 9) + 1}×` },
      { kind: "tag", text: keywords[0] },
    ],
    onSelect: () => undefined,
  };
}

const items = Array.from({ length: 6 }, (_, i) => item(i));

/** The list virtualizes against a host scroll region, so stories supply one. */
const scrolled: Decorator = (Story) => (
  <ScrollArea className="h-[32rem] max-w-2xl rounded-md border border-border p-4">
    <Story />
  </ScrollArea>
);

/**
 * The host's rendering of a plugin-declared list: rows, accessories, optional
 * local search, and the optional timeline with its Today / week / month / all
 * tabs. The plugin supplies data and handlers only.
 */
const meta = {
  title: "Interface/Plugins/PluginListViewBody",
  component: PluginListViewBody,
  parameters: { layout: "padded" },
  args: { busy: false, onResult: noopRunner },
  decorators: [scrolled],
} satisfies Meta<typeof PluginListViewBody>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A plain list: title, subtitle, icon, and trailing accessories. */
export const Default: Story = {
  args: { view: { kind: "list", title: "Saved words", items } },
};

/** With host-rendered local filtering over title, subtitle and keywords. */
export const Searchable: Story = {
  args: {
    view: {
      kind: "list",
      title: "Saved words",
      items,
      searchable: true,
      searchPlaceholder: "Filter words",
    },
  },
};

/**
 * Timeline mode: items are grouped by their timestamp under host-owned tabs.
 * The fixture spreads entries across today, this week and this month so each
 * tab has something to show.
 */
export const Timeline: Story = {
  args: {
    view: { kind: "list", title: "Recently saved", items, timeline: true, searchable: true },
  },
};

/** List-level actions, which a timeline places after its tabs. */
export const WithActions: Story = {
  args: {
    view: { kind: "list", title: "Saved words", items, actions: sampleActions },
  },
};

/** Rows without a drill-down handler are inert — no hover affordance, no click. */
export const NonSelectableRows: Story = {
  args: {
    view: {
      kind: "list",
      title: "Read-only",
      items: items.map(({ onSelect: _onSelect, ...rest }) => rest),
    },
  },
};

/** Icon accessories, with and without a tooltip label. */
export const AccessoryKinds: Story = {
  args: {
    view: {
      kind: "list",
      items: [
        {
          id: "a",
          title: "Text accessory",
          accessories: [{ kind: "text", text: "12 reviews" }],
        },
        { id: "b", title: "Tag accessory", accessories: [{ kind: "tag", text: "archaic" }] },
        {
          id: "c",
          title: "Icon accessory, labelled",
          accessories: [{ kind: "icon", icon: "star", label: "Favourite" }],
        },
        {
          id: "d",
          title: "Icon accessory, bare",
          accessories: [{ kind: "icon", icon: "check" }],
        },
        {
          id: "e",
          title: "Several at once",
          accessories: [
            { kind: "text", text: "3×" },
            { kind: "tag", text: "noun" },
            { kind: "icon", icon: "star", label: "Favourite" },
          ],
        },
      ],
    },
  },
};

/** A thousand rows — the case PluginVirtualRows windows. */
export const LongList: Story = {
  args: {
    view: {
      kind: "list",
      title: "Vocabulary",
      items: Array.from({ length: 1000 }, (_, i) => item(i)),
      searchable: true,
    },
  },
};

/** Long titles and subtitles truncate rather than reflowing the row. */
export const LongText: Story = {
  args: {
    view: {
      kind: "list",
      items: [
        {
          id: "long",
          title: "A headword so long it cannot possibly fit on one line of this row",
          subtitle:
            "And a subtitle that goes on at similar length, describing the sense in full detail without abbreviating anything at all",
          accessories: [{ kind: "tag", text: "very-long-tag-value" }],
        },
      ],
    },
  },
};

/** Empty, with the plugin's own wording for why. */
export const EmptyWithText: Story = {
  args: {
    view: {
      kind: "list",
      title: "Saved words",
      items: [],
      emptyText: "Look up a word while reading and it lands here.",
    },
  },
};

/** Empty with no declared text: the host's own empty state stands in. */
export const EmptyDefault: Story = {
  args: { view: { kind: "list", title: "Saved words", items: [] } },
};

/** While a result runs, selection and actions are disabled. */
export const Busy: Story = {
  args: { busy: true, view: { kind: "list", items, actions: sampleActions } },
};
