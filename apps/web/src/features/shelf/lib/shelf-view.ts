const STORAGE_KEY = "read-aware-shelf-view";

export type ShelfLayout = "grid" | "list";
export type ShelfGroup = "none" | "status" | "author" | "format";
export type ShelfSort = "recent" | "added" | "title" | "author" | "progress";

/** How the shelf is laid out, grouped, and ordered. Persisted, device-local. */
export type ShelfView = {
  layout: ShelfLayout;
  group: ShelfGroup;
  sort: ShelfSort;
  /** Hide books marked finished from the shelf. */
  hideFinished: boolean;
};

// Default is a flat grid sorted by most recently opened — no section partitioning.
export const DEFAULT_SHELF_VIEW: ShelfView = {
  layout: "grid",
  group: "none",
  sort: "recent",
  hideFinished: false,
};

export function getShelfView(): ShelfView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SHELF_VIEW;
    const parsed = JSON.parse(raw) as Partial<ShelfView>;
    return {
      layout: parsed.layout ?? DEFAULT_SHELF_VIEW.layout,
      group: parsed.group ?? DEFAULT_SHELF_VIEW.group,
      sort: parsed.sort ?? DEFAULT_SHELF_VIEW.sort,
      hideFinished: parsed.hideFinished ?? DEFAULT_SHELF_VIEW.hideFinished,
    };
  } catch {
    return DEFAULT_SHELF_VIEW;
  }
}

export function saveShelfView(view: ShelfView): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
}
