import { useEffect, useRef, useState } from "react";
import type { PluginFormValues, PluginFormView, PluginSelectOption } from "../lib/plugin-types";
import { useDebouncedValue } from "./useDebouncedValue";

const MAX_OPTIONS = 500;
const REFETCH_DEBOUNCE_MS = 500;

/** Options cross the plugin boundary untyped — keep only well-formed entries. */
function sanitizeOptions(raw: unknown): PluginSelectOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const options: PluginSelectOption[] = [];
  for (const entry of raw) {
    if (options.length >= MAX_OPTIONS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { value, label } = entry as { value?: unknown; label?: unknown };
    if (typeof value !== "string" || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: typeof label === "string" && label.trim() ? label : value,
    });
  }
  return options;
}

/**
 * Resolved options of one `dynamicOptions` select field.
 *
 * Resolves through the form's `resolveOptions` when the field is visible, and
 * re-resolves when a SIBLING value changes (debounced — a list may depend on
 * a sibling like an endpoint URL, and sibling edits arrive per keystroke).
 * The field's own value is deliberately not a trigger: it selects from the
 * list, it does not shape it. Failures resolve empty; the caller falls back
 * to free text input. Returns null until the first resolution lands.
 */
export function usePluginFieldOptions({
  visible,
  fieldId,
  values,
  resolve,
  revision = 0,
}: {
  visible: boolean;
  fieldId: string;
  values: PluginFormValues;
  resolve: PluginFormView["resolveOptions"];
  /** Bump to force a re-resolve for out-of-band changes (stored secrets). */
  revision?: number;
}): PluginSelectOption[] | null {
  const [options, setOptions] = useState<PluginSelectOption[] | null>(null);

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
    if (!visible || !resolver) return;
    const request = ++requestRef.current;
    Promise.resolve(resolver(fieldId, { ...valuesRef.current }))
      .then((raw) => {
        if (requestRef.current === request) setOptions(sanitizeOptions(raw));
      })
      .catch(() => {
        if (requestRef.current === request) setOptions([]);
      });
  }, [visible, fieldId, siblingsKey, revision]);

  return options;
}
