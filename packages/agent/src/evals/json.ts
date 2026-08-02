import type { JsonObject, JsonValue } from "./types";

const MAX_DEPTH = 40;
const OMITTED = "[omitted]";

function normalizeNumber(value: number): number | string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  return value;
}

function normalizeObject(
  value: object,
  seen: WeakSet<object>,
  depth: number,
): JsonValue {
  if (depth > MAX_DEPTH) return "[max-depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  try {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof URL) return value.toString();
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        ...(value.stack ? { stack: value.stack } : {}),
      };
    }
    if (Array.isArray(value)) {
      return value.map((entry) => toJsonValueInternal(entry, seen, depth + 1));
    }
    if (value instanceof Map) {
      return Array.from(value.entries()).map(([key, entry]) => [
        toJsonValueInternal(key, seen, depth + 1),
        toJsonValueInternal(entry, seen, depth + 1),
      ]);
    }
    if (value instanceof Set) {
      return Array.from(value, (entry) => toJsonValueInternal(entry, seen, depth + 1));
    }
    if (ArrayBuffer.isView(value)) {
      return `[binary ${value.byteLength} bytes]`;
    }
    if (value instanceof ArrayBuffer) return `[binary ${value.byteLength} bytes]`;

    const output: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "function" || typeof entry === "symbol" || entry === undefined) {
        continue;
      }
      output[key] = toJsonValueInternal(entry, seen, depth + 1);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function toJsonValueInternal(value: unknown, seen: WeakSet<object>, depth: number): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return normalizeNumber(value);
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return OMITTED;
    case "object":
      return normalizeObject(value, seen, depth);
  }
  throw new Error("unsupported JavaScript value");
}

export function toJsonValue(value: unknown): JsonValue {
  return toJsonValueInternal(value, new WeakSet(), 0);
}

export function toJsonObject(value: unknown): JsonObject {
  const normalized = toJsonValue(value);
  return normalized !== null && !Array.isArray(normalized) && typeof normalized === "object"
    ? normalized
    : { value: normalized };
}

function redactString(value: string, secrets: string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length >= 8) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

export function redactJson(value: JsonValue, rawSecrets: string[] = []): JsonValue {
  const secrets = [...new Set(rawSecrets.map((entry) => entry.trim()).filter(Boolean))];
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactJson(entry, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactJson(entry, secrets)]),
    );
  }
  return value;
}

export function redactUnknown(value: unknown, secrets: string[] = []): JsonValue {
  return redactJson(toJsonValue(value), secrets);
}
