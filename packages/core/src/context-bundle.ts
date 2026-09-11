import { AppError } from "./errors";

export const CONTEXT_BUNDLE_KINDS = ["user_profile_context", "reading_intent_context", "book_memory_context", "conversation_insights_context"] as const;
export type ContextBundleKind = typeof CONTEXT_BUNDLE_KINDS[number];
export const CONTEXT_BUNDLE_ITEM_KINDS = ["curated_profile", "derived_profile", "reading_goal", "memory", "annotation", "chapter_digest", "conversation_insight", "entity"] as const;
export type ContextBundleItemKind = typeof CONTEXT_BUNDLE_ITEM_KINDS[number];
export type ContextBundleScope = { kind: "user" } | { kind: "book" | "conversation"; id: string };
export type ContextBundleSelector = { kind: ContextBundleKind; scope: ContextBundleScope };
export type ContextBundleItem = { kind: ContextBundleItemKind; id: string; revision: string; label: string; text: string };
export type ContextBundleOmission = { kind: ContextBundleItemKind; reason: "privacy" | "spoiler" | "unavailable"; count: number };
export type ContextBundleContent = {
  format: "readaware.context";
  schemaVersion: 1;
  recipeVersion: 1;
  kind: ContextBundleKind;
  scope: ContextBundleScope;
  sourceRevision: string;
  items: ContextBundleItem[];
  omissions: ContextBundleOmission[];
};
export type ContextBundle = { version: string; content: ContextBundleContent };
export const CONTEXT_BUNDLE_MAX_BYTES = 1024 * 1024;

const invalid = (): never => { throw new AppError("memory/invalid-input", "Invalid context bundle"); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || !empty && !value.length
    || /[\u0000\uD800-\uDFFF]/u.test(value)) return invalid();
  return value;
}
function itemKind(value: unknown): ContextBundleItemKind {
  if (!CONTEXT_BUNDLE_ITEM_KINDS.includes(value as ContextBundleItemKind)) return invalid();
  return value as ContextBundleItemKind;
}
const RECIPE_ITEMS: Record<ContextBundleKind, readonly ContextBundleItemKind[]> = {
  user_profile_context: ["curated_profile", "derived_profile", "memory", "entity"],
  reading_intent_context: ["reading_goal", "memory"],
  book_memory_context: ["memory", "annotation", "chapter_digest"],
  conversation_insights_context: ["conversation_insight", "memory"],
};

/** The same recipe/scope rules apply to artifacts and archive selectors. */
export function contextBundleSelector(input: unknown): ContextBundleSelector {
  const p = object(input, ["kind", "scope"]);
  if (!CONTEXT_BUNDLE_KINDS.includes(p.kind as ContextBundleKind)) return invalid();
  const rawScope = object(p.scope, (p.scope as ContextBundleScope)?.kind === "user" ? ["kind"] : ["kind", "id"]);
  let scope: ContextBundleScope;
  if (rawScope.kind === "user") scope = { kind: "user" };
  else if (rawScope.kind === "book" || rawScope.kind === "conversation") scope = { kind: rawScope.kind, id: text(rawScope.id, 256) };
  else return invalid();
  const kind = p.kind as ContextBundleKind;
  if (kind === "user_profile_context" && scope.kind !== "user"
    || kind === "book_memory_context" && scope.kind !== "book"
    || kind === "reading_intent_context" && scope.kind === "conversation"
    || kind === "conversation_insights_context" && scope.kind === "user") return invalid();
  return { kind, scope };
}

/** A copied, schema-closed artifact. Source authorization belongs to the producer. */
export function normalizeContextBundleContent(input: unknown): ContextBundleContent {
  const p = object(input, ["format", "schemaVersion", "recipeVersion", "kind", "scope", "sourceRevision", "items", "omissions"]);
  if (p.format !== "readaware.context" || p.schemaVersion !== 1 || p.recipeVersion !== 1) return invalid();
  const { kind, scope } = contextBundleSelector({ kind: p.kind, scope: p.scope });
  if (!Array.isArray(p.items) || p.items.length > 512 || !Array.isArray(p.omissions) || p.omissions.length > 24) return invalid();
  const identities = new Set<string>(), omitted = new Set<string>();
  const items = p.items.map(value => {
    const item = object(value, ["kind", "id", "revision", "label", "text"]);
    const result = { kind: itemKind(item.kind), id: text(item.id, 256), revision: text(item.revision, 256), label: text(item.label, 512, true), text: text(item.text, CONTEXT_BUNDLE_MAX_BYTES, true) };
    const key = JSON.stringify([result.kind, result.id]);
    if (!RECIPE_ITEMS[kind].includes(result.kind) || identities.has(key)) return invalid(); identities.add(key);
    return result;
  });
  const omissions = p.omissions.map(value => {
    const item = object(value, ["kind", "reason", "count"]), omittedKind = itemKind(item.kind);
    if (!["privacy", "spoiler", "unavailable"].includes(item.reason as string)
      || !Number.isSafeInteger(item.count) || (item.count as number) < 1) return invalid();
    const reason = item.reason as ContextBundleOmission["reason"], key = JSON.stringify([omittedKind, reason]);
    if (!RECIPE_ITEMS[kind].includes(omittedKind) || omitted.has(key)) return invalid(); omitted.add(key);
    return { kind: omittedKind, reason, count: item.count as number };
  });
  const content: ContextBundleContent = { format: "readaware.context", schemaVersion: 1, recipeVersion: 1, kind,
    scope, sourceRevision: text(p.sourceRevision, 256), items, omissions };
  if (new TextEncoder().encode(encode(content)).byteLength > CONTEXT_BUNDLE_MAX_BYTES) return invalid();
  return content;
}

function encode(content: ContextBundleContent): string {
  return JSON.stringify([content.format, content.schemaVersion, content.recipeVersion, content.kind, content.scope.kind,
    content.scope.kind === "user" ? null : content.scope.id, content.sourceRevision,
    content.items.map(item => [item.kind, item.id, item.revision, item.label, item.text]),
    content.omissions.map(item => [item.kind, item.reason, item.count])]);
}
export function canonicalContextBundle(input: unknown): string { return encode(normalizeContextBundleContent(input)); }
export async function createContextBundle(input: unknown): Promise<ContextBundle> {
  const content = normalizeContextBundleContent(input);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encode(content)));
  return { version: `cb1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`, content };
}
export async function validateContextBundle(input: unknown): Promise<ContextBundle> {
  const value = object(input, ["version", "content"]), bundle = await createContextBundle(value.content);
  if (value.version !== bundle.version) return invalid();
  return bundle;
}
