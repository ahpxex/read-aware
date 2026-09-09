import type { PluginBlock, PluginFormField, PluginFormValues, PluginFormView, PluginView } from "./plugin-types";

function defaults(fields: PluginFormField[]): PluginFormValues {
  return Object.fromEntries(fields.filter(field => field.kind !== "secret").map(field => [field.id,
    field.kind === "toggle" || field.kind === "checkbox" ? field.value ?? false
      : field.kind === "number" ? field.value ?? 0
        : field.kind === "select" || field.kind === "choice" ? field.value ?? (field.kind === "select" && field.dynamicOptions ? "" : field.options[0]?.value ?? "")
          : "value" in field ? field.value ?? "" : "",
  ]));
}

/** In-memory editor state owned by a navigation frame, never plugin storage. */
export class PluginFormDraft {
  private values: PluginFormValues = {};
  private baseline: PluginFormValues = {};
  private kinds = new Map<string, string>();
  private passwords = new Set<string>();
  private active = true;
  private listeners = new Set<() => void>();

  constructor(fields: PluginFormField[]) { this.reconcile(fields); }
  getSnapshot = (): PluginFormValues => this.values;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(values: PluginFormValues): void {
    if (Object.keys(values).length === Object.keys(this.values).length && Object.entries(values).every(([id, value]) => Object.is(this.values[id], value))) return;
    this.values = values;
    for (const listener of [...this.listeners]) listener();
  }
  reconcile(fields: PluginFormField[]): void {
    if (!this.active) return;
    const next = defaults(fields), values = { ...next };
    const kinds = new Map<string, string>(), passwords = new Set<string>();
    for (const field of fields) {
      if (field.kind === "secret") continue;
      const kind = field.kind === "text" ? `${field.kind}:${field.inputMode ?? "text"}` : field.kind;
      kinds.set(field.id, kind);
      if (field.kind === "text" && field.inputMode === "password") passwords.add(field.id);
      values[field.id] = this.kinds.get(field.id) === kind && !Object.is(this.values[field.id], this.baseline[field.id])
        ? this.values[field.id] : next[field.id];
    }
    this.baseline = next; this.kinds = kinds; this.passwords = passwords;
    this.publish(values);
  }
  update(id: string, value: string | number | boolean): void {
    if (!this.active || !this.kinds.has(id)) return;
    const kind = this.kinds.get(id);
    const type = kind === "number" ? "number" : kind === "toggle" || kind === "checkbox" ? "boolean" : "string";
    if (typeof value !== type || (typeof value === "number" && !Number.isFinite(value))) return;
    this.publish({ ...this.values, [id]: value });
  }
  hide(): void {
    const values = { ...this.values };
    for (const id of this.passwords) { values[id] = ""; this.baseline[id] = ""; }
    this.publish(values);
  }
  dispose(): void {
    this.active = false; this.baseline = {}; this.kinds.clear(); this.passwords.clear();
    this.publish({}); this.listeners.clear();
  }
}

/** Structural paths match renderer identity; explicit navigation gets a new owner. */
export class PluginFormDrafts {
  private active = true;
  private drafts = new Map<string, PluginFormDraft>();
  private bindings = new WeakMap<PluginFormView, PluginFormDraft>();
  constructor(view: PluginView) { this.reconcile(view); }
  get(view: PluginFormView): PluginFormDraft | undefined { return this.bindings.get(view); }
  reconcile(view: PluginView): void {
    if (!this.active) return;
    const next = new Map<string, PluginFormDraft>();
    const visit = (block: PluginBlock | PluginView, path: string): void => {
      const key = `${path}/${block.kind}`;
      if (block.kind === "form") {
        const draft = this.drafts.get(key) ?? new PluginFormDraft(block.fields);
        draft.reconcile(block.fields); next.set(key, draft); this.bindings.set(block, draft);
      } else if (block.kind === "blocks" || block.kind === "group" || block.kind === "section") {
        block.blocks.forEach((child, i) => visit(child, `${key}/${i}`));
      } else if (block.kind === "detail") {
        block.content.forEach((child, i) => visit(child, `${key}/${i}`));
      } else if (block.kind === "columns") {
        block.cells.forEach((cell, i) => cell.blocks.forEach((child, j) => visit(child, `${key}/${i}/${j}`)));
      } else if (block.kind === "row") {
        block.cells.forEach((cell, i) => visit(cell.block, `${key}/${i}`));
      }
    };
    visit(view, "root");
    for (const [key, draft] of this.drafts) if (!next.has(key)) draft.dispose();
    this.drafts = next;
  }
  hide(): void { for (const draft of this.drafts.values()) draft.hide(); }
  dispose(): void { this.active = false; for (const draft of this.drafts.values()) draft.dispose(); this.drafts.clear(); this.bindings = new WeakMap(); }
}
