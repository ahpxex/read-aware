import type { Meta, StoryObj } from "@storybook/react-vite";
import { PluginTableViewBody } from "./PluginTableViewBody";
import { PluginViewRenderer } from "./PluginViewRenderer";
import type { PluginTableSort, PluginTableView } from "../lib/plugin-types";
import { noopRunner } from "./plugin.fixtures";

const books = [
  { id: "one", title: "The Structure of Scientific Revolutions", minutes: 180 },
  { id: "two", title: "A Room of One's Own", minutes: 95 },
  { id: "three", title: "The Practice of Everyday Life", minutes: 120 },
];
function table(page = 1, sort: PluginTableSort = { column: "title", direction: "ascending" }): PluginTableView {
  const ordered = [...books].sort((a, b) => (sort.column === "minutes" ? a.minutes - b.minutes : a.title.localeCompare(b.title)) * (sort.direction === "ascending" ? 1 : -1));
  return { kind: "table", title: "Reading time",
    columns: [{ id: "title", label: "Book", sortable: true }, { id: "minutes", label: "Minutes", sortable: true, align: "end" }],
    rows: ordered.slice((page - 1) * 2, page * 2).map(book => ({ id: book.id, label: book.title, cells: { title: book.title, minutes: book.minutes },
      presentation: "dialog", onSelect: () => ({ view: { kind: "markdown", title: book.title, markdown: `${book.minutes} minutes` } }) })),
    sort: { value: sort, onChange: next => ({ view: table(1, next) }) },
    pagination: { page, pageCount: 2,
      onPrevious: page > 1 ? () => ({ view: table(page - 1, sort) }) : undefined,
      onNext: page < 2 ? () => ({ view: table(page + 1, sort) }) : undefined },
  };
}
const meta = {
  title: "Interface/Plugins/PluginTableViewBody", component: PluginTableViewBody,
  parameters: { layout: "padded" }, args: { view: table(), busy: false, onResult: noopRunner },
} satisfies Meta<typeof PluginTableViewBody>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Busy: Story = { args: { busy: true } };
export const EmptyPage: Story = { args: { view: { ...table(2), rows: [] } } };
export const Narrow: Story = { decorators: [Story => <div className="w-72"><Story /></div>] };
export const Interactive: Story = { render: () => <PluginViewRenderer view={table()} scroll="flow" /> };
