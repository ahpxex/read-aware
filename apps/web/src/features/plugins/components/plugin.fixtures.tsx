/**
 * Shared story fixtures for the plugin host surfaces.
 *
 * The host renders whatever a plugin declares, so the fixtures here are
 * written as a plugin author would write them — plain contribution data, no
 * host internals. `noopRunner` stands in for the real result runner, which in
 * the app dispatches navigation, dialogs and toasts; in a story it just runs
 * the handler and returns its result.
 *
 * Story-only: nothing in the product imports this module.
 */
import type {
  PluginAction,
  PluginBlock,
  PluginDetailControl,
  PluginMetadataItem,
} from "../lib/plugin-types";
import type { PluginResultRunner } from "./plugin-view-types";

/** Runs the handler and hands back its result, with no host side effects. */
export const noopRunner: PluginResultRunner = async (run) => run();

export const sampleActions: PluginAction[] = [
  { id: "save", label: "Save to notebook", icon: "notebook", variant: "solid", run: () => undefined },
  { id: "copy", label: "Copy", icon: "copy", run: () => undefined },
  { id: "share", label: "Share", icon: "share", variant: "ghost", run: () => undefined },
];

export const destructiveActions: PluginAction[] = [
  { id: "export", label: "Export", icon: "export", variant: "outline", run: () => undefined },
  { id: "delete", label: "Delete entry", icon: "trash", variant: "danger", run: () => undefined },
];

export const sampleMetadata: PluginMetadataItem[] = [
  { kind: "label", label: "Source", value: "Wiktionary", icon: "globe" },
  { kind: "label", label: "Added", value: "12 June 2026", icon: "calendar" },
  { kind: "divider" },
  { kind: "tags", label: "Tags", values: ["noun", "archaic", "literary"] },
];

export const sampleControls: PluginDetailControl[] = [
  {
    kind: "select",
    id: "sort",
    label: "Sort",
    value: "recent",
    icon: "rows",
    options: [
      { value: "recent", label: "Most recent" },
      { value: "alpha", label: "A–Z" },
      { value: "reviewed", label: "Least reviewed" },
    ],
    onChange: () => undefined,
  },
  {
    kind: "select",
    id: "scope",
    label: "Scope",
    value: "all",
    icon: "books",
    options: [
      { value: "all", label: "All books" },
      { value: "current", label: "This book" },
    ],
    onChange: () => undefined,
  },
];

/** One block of each simple kind — the renderer's whole vocabulary, flat. */
export const everyBlockKind: PluginBlock[] = [
  { kind: "text", text: "Vocabulary review", variant: "heading" },
  { kind: "text", text: "Words saved while reading, oldest first.", tone: "muted" },
  { kind: "heading", text: "Provenance", caption: "Where this entry came from" },
  {
    kind: "keyValue",
    rows: [
      { label: "Book", value: "Pale Fire" },
      { label: "Chapter", value: "Commentary, lines 47–48" },
      { label: "Saved", value: "12 June 2026" },
    ],
  },
  { kind: "quote", text: "I was the shadow of the waxwing slain.", caption: "John Shade" },
  { kind: "metric", label: "Reviewed", value: "18 times", description: "since June" },
  { kind: "progress", value: 62, label: "Retention", showValue: true },
  { kind: "tags", label: "Tags", values: ["poetry", "annotated"] },
  { kind: "alert", title: "Sync pending", message: "Three entries are waiting to upload.", variant: "default" },
  { kind: "divider" },
  { kind: "markdown", markdown: "A **markdown** block, with a [link](https://example.com) and `code`." },
];
