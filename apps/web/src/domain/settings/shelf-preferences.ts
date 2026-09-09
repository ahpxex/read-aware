import type { SettingDefinition } from "./catalog";

/** View preferences never mutate books, active filters, or the user's selection. */
export function shelfPreferenceDefinitions(): SettingDefinition[] {
  return ([
    ["layout", "Shelf layout", ["grid", "list"]],
    ["group", "Shelf grouping", ["none", "status", "author", "format"]],
    ["sort", "Shelf ordering", ["recent", "added", "title", "author", "progress"]],
  ] as const).map(([key, label, values]) => ({
    path: `shelf.${key}`, section: "shelf", label, kind: "enum", supportedTargets: ["global"],
    description: "Device-local shelf view preference. Does not navigate, select books, filter the library, or alter book data.",
    options: values.map(value => ({ value, label: value })),
    read: state => state.shelf[key],
    write: (state, value) => { state.shelf = { ...state.shelf, [key]: value }; },
  }));
}
