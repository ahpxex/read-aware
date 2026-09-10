import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PluginTreeView } from "../lib/plugin-types";
import { PluginTreeViewBody } from "./PluginTreeViewBody";
import { PluginViewRenderer } from "./PluginViewRenderer";
import { noopRunner } from "./plugin.fixtures";

const view: PluginTreeView = { kind: "tree", title: "Contents", expandedIds: ["part-one"], nodes: [
  { id: "part-one", title: "Part one", children: [
    { id: "introduction", title: "Introduction", subtitle: "A question of perspective", presentation: "dialog",
      onSelect: () => ({ view: { kind: "markdown", title: "Introduction", markdown: "A question of perspective." } }) },
    { id: "chapter-one", title: "Chapter one", children: [{ id: "section-one", title: "The structure of an argument" }] },
  ] },
  { id: "part-two", title: "Part two", children: [{ id: "chapter-two", title: "Chapter two" }] },
] };
const meta = {
  title: "Interface/Plugins/PluginTreeViewBody", component: PluginTreeViewBody,
  parameters: { layout: "padded" }, args: { view, busy: false, onResult: noopRunner },
} satisfies Meta<typeof PluginTreeViewBody>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Busy: Story = { args: { busy: true } };
export const EmptyPage: Story = { args: { view: { ...view, nodes: [], expandedIds: [], pagination: { page: 2, onPrevious: () => ({ view }) } } } };
export const Narrow: Story = { decorators: [Story => <div className="w-60"><Story /></div>] };
export const Interactive: Story = { render: () => <PluginViewRenderer view={view} scroll="flow" /> };
