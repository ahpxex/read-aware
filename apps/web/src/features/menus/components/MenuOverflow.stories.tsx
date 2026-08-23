import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowsClockwise,
  ChartLineUp,
  Export,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
  Trash,
} from "@phosphor-icons/react";
import { Popover } from "@read-aware/ui";
import { userEvent, within } from "storybook/test";
import { MenuOverflow, type MenuOverflowEntry } from "./MenuOverflow";

const icon = (Glyph: typeof Plus) => <Glyph size={16} weight="regular" aria-hidden="true" />;

const actions: MenuOverflowEntry[] = [
  { id: "search", label: "Search", icon: icon(MagnifyingGlass), run: () => {} },
  { id: "import", label: "Import books", icon: icon(Plus), run: () => {} },
  { id: "stats", label: "Reading stats", icon: icon(ChartLineUp), run: () => {} },
  { id: "export", label: "Export library", icon: icon(Export), run: () => {} },
];

/** A widget row: the label reads like an action, but it opens its own panel. */
const widget: MenuOverflowEntry = {
  id: "view",
  label: "View options",
  icon: icon(SlidersHorizontal),
  node: (
    <Popover
      align="right"
      triggerLabel="View options"
      trigger={<span>View options</span>}
      panelClassName="w-48 p-3"
    >
      <span className="text-sm text-fg-muted">Grid / list, sort order…</span>
    </Popover>
  ),
};

/**
 * The vertical-dots menu every customizable surface shares — whatever the user
 * did not place inline lives here, core items and plugin contributions alike.
 *
 * Two row kinds: plain actions, which run and close the menu; and widget rows,
 * whose own popover opens from inside this panel, so the menu has to stay open
 * and must not clip. That difference changes the panel's overflow rules, so
 * both have stories.
 */
const meta = {
  title: "Interface/Menus/MenuOverflow",
  component: MenuOverflow,
  parameters: { layout: "centered" },
  args: { entries: actions },
  decorators: [
    (Story) => (
      <div className="flex w-[24rem] items-center justify-end rounded-md border border-border bg-surface px-3 py-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MenuOverflow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The closed trigger, as it sits at the end of a bar. */
export const Closed: Story = {};

/** Opened: a plain action list. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More" }));
  },
};

/** A disabled row — inert, but still shown, so the surface doesn't shift. */
export const WithDisabledEntry: Story = {
  args: {
    entries: [
      { ...actions[0] },
      { id: "import", label: "Import books", icon: icon(Plus), disabled: true },
      { ...actions[2] },
    ],
  },
  play: Open.play,
};

/**
 * With a widget row present the panel stops clipping, so the nested popover can
 * grow outward past the menu's bounds.
 */
export const WithWidgetRow: Story = {
  args: { entries: [actions[0], widget, actions[3]] },
  play: Open.play,
};

/** A long list scrolls inside the panel — action lists cap their height. */
export const ManyEntries: Story = {
  args: {
    entries: Array.from({ length: 16 }, (_, i) => ({
      id: `a${i}`,
      label: `Menu entry number ${i + 1}`,
      icon: icon(ArrowsClockwise),
      run: () => {},
    })),
  },
  play: Open.play,
};

/** Long labels truncate rather than widening the panel. */
export const LongLabels: Story = {
  args: {
    entries: [
      {
        id: "long",
        label: "Remove every book that has not been opened in the past year",
        icon: icon(Trash),
        run: () => {},
      },
      ...actions,
    ],
  },
  play: Open.play,
};

/** Entries without icons still align with those that have them. */
export const WithoutIcons: Story = {
  args: {
    entries: [
      { id: "a", label: "First action", run: () => {} },
      { id: "b", label: "Second action", run: () => {} },
    ],
  },
  play: Open.play,
};

/** The compact trigger, for dense bars like the selection menu. */
export const SmallTrigger: Story = {
  args: { size: "sm" },
};

/** Opening leftward, for a trigger at the right edge of a narrow surface. */
export const AlignedLeft: Story = {
  args: { align: "left" },
  play: Open.play,
};

/** Nothing overflowed: the trigger is not drawn at all. */
export const NoEntries: Story = {
  args: { entries: [] },
};
