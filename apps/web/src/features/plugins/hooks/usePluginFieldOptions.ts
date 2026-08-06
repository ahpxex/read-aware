import { useEffect, useRef, useState } from "react";
import { contributionText } from "../lib/plugin-i18n";
import type { PluginFormValues, PluginFormView, PluginText } from "../lib/plugin-types";
import { useDebouncedValue } from "./useDebouncedValue";

const MAX_OPTIONS = 500;
const REFETCH_DEBOUNCE_MS = 500;

/** A resolved option as the form renders it: plain strings only. */
export type ResolvedFieldOption = { value: string; label: string };

function labelText(label: unknown, fallback: string): string {
  if (typeof label === "string" && label.trim()) return label;
  if (
    typeof label === "object" &&
    label !== null &&
    typeof (label as { default?: unknown }).default === "string"
  ) {
    return contributionText(label as PluginText);
  }
  return fallback;
}

/** Options cross the plugin boundary untyped — keep only well-formed entries. */
function sanitizeOptions(raw: unknown): ResolvedFieldOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const options: ResolvedFieldOption[] = [];
  for (const entry of raw) {
    if (options.length >= MAX_OPTIONS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { value, label } = entry as { value?: unknown; label?: unknown };
    if (typeof value !== "string" || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: labelText(label, value) });
  }
  return options;
}

/**
 * Resolved options of one `dynamicOptions` select field.
 *
 * Resolves through the form's `resolveOptions` on mount, and re-resolves
 * when a SIBLING value changes (debounced — a list may depend on
 * a sibling like an endpoint URL, and sibling edits arrive per keystroke).
 * The field's own value is deliberately not a trigger: it selects from the
 * list, it does not shape it. Failures resolve empty; the caller falls back
 * to free text input. Returns null until the first resolution lands.
 */
export function usePluginFieldOptions({
  fieldId,
  values,
  resolve,
  revision = 0,
}: {
  fieldId: string;
  values: PluginFormValues;
  resolve: PluginFormView["resolveOptions"];
  /** Bump to force a re-resolve for out-of-band changes (stored secrets). */
  revision?: number;
}): ResolvedFieldOption[] | null {
  const [options, setOptions] = useState<ResolvedFieldOption[] | null>(null);

  const siblings: PluginFormValues = { ...values };
  delete siblings[fieldId];
  const siblingsKey = useDebouncedValue(JSON.stringify(siblings), REFETCH_DEBOUNCE_MS);

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const requestRef = useRef(0);

  useEffect(() => {
    const resolver = resolveRef.current;
    if (!resolver) return;
    const request = ++requestRef.current;
    Promise.resolve(resolver(fieldId, { ...valuesRef.current }))
      .then((raw) => {
        if (requestRef.current === request) setOptions(sanitizeOptions(raw));
      })
      .catch(() => {
        if (requestRef.current === request) setOptions([]);
      });
  }, [fieldId, siblingsKey, revision]);

  return options;
}
