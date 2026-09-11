import { AppError } from "./errors";
import { createContextBundle } from "./context-bundle";

export type ReadingIntentScope = { kind: "user" } | { kind: "book"; id: string };
export type ReadingIntentSnapshot = { revision: string | null; text: string | null };
export type ReadingIntentSource = ReadingIntentSnapshot & { pluginId: string; providerId: string };
const invalid = (): never => { throw new AppError("memory/invalid-input", "Invalid reading intention source"); };
const validText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000\uD800-\uDFFF]/u.test(value);

export function normalizeReadingIntentScope(input: ReadingIntentScope): ReadingIntentScope {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  if (input.kind === "user" && Object.keys(input).length === 1) return { kind: "user" };
  if (input.kind === "book" && Object.keys(input).sort().join(",") === "id,kind" && validText(input.id, 256)) return { kind: "book", id: input.id };
  return invalid();
}
export function normalizeReadingIntentSnapshot(input: ReadingIntentSnapshot): ReadingIntentSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== "revision,text"
    || input.revision !== null && !validText(input.revision, 256)
    || input.text !== null && (!validText(input.text, 1024 * 1024) || input.revision === null)) return invalid();
  return { revision: input.revision, text: input.text };
}

export async function readingIntentContextBundle(inputScope: ReadingIntentScope, inputSources: ReadingIntentSource[]) {
  const scope = normalizeReadingIntentScope(inputScope);
  if (!Array.isArray(inputSources) || inputSources.length > 512) return invalid();
  const keys = new Set<string>();
  const sources = inputSources.map(source => {
    if (!source || Object.keys(source).sort().join(",") !== "pluginId,providerId,revision,text"
      || !validText(source.pluginId, 120) || !validText(source.providerId, 120)) return invalid();
    const key = JSON.stringify([source.pluginId, source.providerId]);
    if (keys.has(key)) return invalid(); keys.add(key);
    return { pluginId: source.pluginId, providerId: source.providerId,
      ...normalizeReadingIntentSnapshot({ revision: source.revision, text: source.text }) };
  }).sort((a, b) => a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0);
  const bytes = new TextEncoder().encode(JSON.stringify(["reading-intent", 1, scope.kind, scope.kind === "book" ? scope.id : null,
    sources.map(source => [source.pluginId, source.providerId, source.revision, source.text])]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const sourceRevision = `rint1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  return createContextBundle({ format: "readaware.context", schemaVersion: 1, recipeVersion: 1, kind: "reading_intent_context", scope, sourceRevision,
    items: sources.flatMap(source => source.text === null ? [] : [{ kind: "reading_goal", id: JSON.stringify([source.pluginId, source.providerId]),
      revision: source.revision, label: `Reading intention (${source.pluginId}/${source.providerId})`, text: source.text }]), omissions: [] });
}
