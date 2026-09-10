import { expect, test } from "bun:test";
import type { PluginTableView } from "./plugin-types";
import { normalizePluginView } from "./plugin-view";

const table = (): PluginTableView => ({
  kind: "table", columns: [{ id: "title", label: "Book", sortable: true }, { id: "minutes", label: "Minutes", align: "end" }],
  rows: [{ id: "one", label: "Book one", cells: { title: "Book one", minutes: 15 }, onSelect: () => null }],
  sort: { value: { column: "minutes", direction: "ascending" }, onChange: () => null },
});
const validTable = (): PluginTableView => ({ ...table(), sort: { value: { column: "title", direction: "ascending" }, onChange: () => null } });

test("paged lists preserve opaque callbacks for known and unknown page counts, including empty pages", () => {
  for (const pageCount of [undefined, 3]) {
    const pagination = { page: 2, pageCount, onPrevious: () => null, onNext: () => null };
    const result = normalizePluginView({ kind: "list", items: [], pagination });
    expect(result.kind).toBe("list");
    if (result.kind !== "list") throw new Error("Expected list");
    expect(result.pagination).toEqual(pagination);
  }
  for (const pagination of [{ page: 0 }, { page: 1.5 }, { page: 2, pageCount: 1 }, { page: 1, pageCount: 0 },
    { page: 1, onPrevious: () => null }, { page: 1, pageCount: 1, onNext: () => null }, { page: 1, onNext: true }]) {
    expect(() => normalizePluginView({ kind: "list", items: [], pagination })).toThrow();
  }
});

test("tables work at root and inside composed blocks, preserving data, sorting, paging and row actions", () => {
  const raw: PluginTableView = { ...validTable(), pagination: { page: 1, onNext: () => null } };
  const result = normalizePluginView(raw);
  expect(result.kind).toBe("table");
  if (result.kind !== "table") throw new Error("Expected table");
  expect(result.rows[0].cells).toEqual(raw.rows[0].cells);
  expect(result.rows[0].onSelect).toBe(raw.rows[0].onSelect);
  expect(result.sort?.onChange).toBe(raw.sort?.onChange);
  expect(result.pagination?.onNext).toBe(raw.pagination?.onNext);
  const composed = normalizePluginView({ kind: "detail", content: [{ kind: "group", blocks: [raw] }] });
  expect(composed.kind).toBe("detail");
  expect(normalizePluginView({ ...raw, rows: [] }).kind).toBe("table");
});

test("table boundaries reject ambiguous identities, unsafe cells, unknown sorting and unbounded dimensions", () => {
  const raw = validTable();
  const invalid = [
    table(), { ...raw, sort: undefined }, { ...raw, sort: { onChange: "callback" } },
    { ...raw, sort: { onChange: () => null, value: { column: "title", direction: "sideways" } } },
    { ...raw, columns: [] }, { ...raw, columns: [raw.columns[0], raw.columns[0]] },
    { ...raw, rows: [raw.rows[0], raw.rows[0]] },
    { ...raw, rows: [{ ...raw.rows[0], cells: { title: "One" } }] },
    { ...raw, rows: [{ ...raw.rows[0], cells: { title: "One", minutes: Infinity } }] },
    { ...raw, rows: [{ ...raw.rows[0], cells: { title: { html: "<b>One</b>" }, minutes: 1 } }] },
    { ...raw, rows: Array.from({ length: 201 }, (_, i) => ({ ...raw.rows[0], id: String(i) })) },
    { ...raw, columns: Array.from({ length: 17 }, (_, i) => ({ id: String(i), label: String(i) })) },
  ];
  for (const value of invalid) expect(() => normalizePluginView(value)).toThrow();
});
