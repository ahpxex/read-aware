/** Runtime boundary for plugin-authored view declarations. */
import type {
  PluginAction,
  PluginBlock,
  PluginColumnCell,
  PluginDetailControl,
  PluginDetailView,
  PluginDictionaryEntry,
  PluginFormField,
  PluginFormView,
  PluginListAccessory,
  PluginListItem,
  PluginListView,
  PluginMetadataItem,
  PluginView,
} from "./plugin-types";

const MAX_DEPTH = 6;
const MAX_BLOCKS = 120;
const MAX_LIST_ITEMS = 500;
const MAX_FORM_FIELDS = 40;
const MAX_ACTIONS = 20;
const MAX_DETAIL_CONTROLS = 8;
const MAX_CONTROL_OPTIONS = 30;

export class PluginViewError extends Error {}

/** Apply untrusted plugin navigation without leaking stack mutation into UI code. */
export function navigatePluginViewStack(
  previous: PluginView[],
  next: PluginView,
  navigation: unknown = "push",
): PluginView[] {
  if (navigation === "reset") return [next];
  if (navigation === "replace") return [...previous.slice(0, -1), next];
  if (navigation === "push") return [...previous, next];
  throw new PluginViewError(`unknown plugin navigation mode: ${String(navigation)}`);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PluginViewError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, context: string, optional = false): string | undefined {
  if (value == null && optional) return undefined;
  if (typeof value !== "string") throw new PluginViewError(`${context} must be a string`);
  return value;
}

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PluginViewError(`${context} must be a finite number`);
  }
  return value;
}

function array(value: unknown, context: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new PluginViewError(`${context} must be an array`);
  if (value.length > max) throw new PluginViewError(`${context} exceeds the ${max}-item limit`);
  return value;
}

function oneOf<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  context: string,
): T {
  if (value == null) return fallback;
  if (!allowed.includes(value as T)) {
    throw new PluginViewError(`${context} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function normalizeAction(input: unknown, context: string): PluginAction {
  const value = record(input, context);
  if (typeof value.run !== "function") throw new PluginViewError(`${context}.run must be a function`);
  return {
    id: string(value.id, `${context}.id`)!,
    label: string(value.label, `${context}.label`)!,
    icon: string(value.icon, `${context}.icon`, true),
    variant: oneOf(
      value.variant,
      ["solid", "outline", "ghost", "danger"] as const,
      "outline",
      `${context}.variant`,
    ),
    run: value.run as PluginAction["run"],
  };
}

function normalizeActions(value: unknown, context: string): PluginAction[] {
  return array(value, context, MAX_ACTIONS).map((action, index) =>
    normalizeAction(action, `${context}[${index}]`),
  );
}

function normalizeDetailControl(input: unknown, context: string): PluginDetailControl {
  const value = record(input, context);
  const kind = string(value.kind, `${context}.kind`);
  if (kind !== "select") {
    throw new PluginViewError(`${context}.kind "${kind}" is not supported`);
  }
  if (typeof value.onChange !== "function") {
    throw new PluginViewError(`${context}.onChange must be a function`);
  }
  const options = array(value.options, `${context}.options`, MAX_CONTROL_OPTIONS).map(
    (option, index) => {
      const entry = record(option, `${context}.options[${index}]`);
      return {
        value: string(entry.value, `${context}.options[${index}].value`)!,
        label: string(entry.label, `${context}.options[${index}].label`)!,
      };
    },
  );
  if (options.length === 0) {
    throw new PluginViewError(`${context}.options must contain at least one option`);
  }
  const selectedValue = string(value.value, `${context}.value`)!;
  if (!options.some((option) => option.value === selectedValue)) {
    throw new PluginViewError(`${context}.value must match one of its options`);
  }
  return {
    kind,
    id: string(value.id, `${context}.id`)!,
    label: string(value.label, `${context}.label`)!,
    value: selectedValue,
    icon: string(value.icon, `${context}.icon`, true),
    options,
    onChange: value.onChange as PluginDetailControl["onChange"],
  };
}

function normalizeDetailControls(value: unknown, context: string): PluginDetailControl[] {
  return array(value, context, MAX_DETAIL_CONTROLS).map((control, index) =>
    normalizeDetailControl(control, `${context}[${index}]`),
  );
}

function normalizeListAccessory(input: unknown, context: string): PluginListAccessory {
  const value = record(input, context);
  const kind = string(value.kind, `${context}.kind`);
  if (kind === "text" || kind === "tag") {
    return { kind, text: string(value.text, `${context}.text`)! };
  }
  if (kind === "icon") {
    return {
      kind,
      icon: string(value.icon, `${context}.icon`)!,
      label: string(value.label, `${context}.label`, true),
    };
  }
  throw new PluginViewError(`${context}.kind is not supported`);
}

function normalizeListItem(input: unknown, context: string): PluginListItem {
  const value = record(input, context);
  if (value.onSelect != null && typeof value.onSelect !== "function") {
    throw new PluginViewError(`${context}.onSelect must be a function`);
  }
  return {
    id: string(value.id, `${context}.id`)!,
    title: string(value.title, `${context}.title`)!,
    subtitle: string(value.subtitle, `${context}.subtitle`, true),
    timestamp: string(value.timestamp, `${context}.timestamp`, true),
    icon: string(value.icon, `${context}.icon`, true),
    presentation:
      value.presentation == null
        ? undefined
        : oneOf(
            value.presentation,
            ["push", "dialog"] as const,
            "push",
            `${context}.presentation`,
          ),
    keywords:
      value.keywords == null
        ? undefined
        : array(value.keywords, `${context}.keywords`, 40).map((keyword, index) =>
            string(keyword, `${context}.keywords[${index}]`)!,
          ),
    accessories:
      value.accessories == null
        ? undefined
        : array(value.accessories, `${context}.accessories`, 6).map((accessory, index) =>
            normalizeListAccessory(accessory, `${context}.accessories[${index}]`),
          ),
    onSelect: value.onSelect as PluginListItem["onSelect"],
  };
}

function normalizeListView(input: Record<string, unknown>, context: string): PluginListView {
  return {
    kind: "list",
    title: string(input.title, `${context}.title`, true),
    items: array(input.items, `${context}.items`, MAX_LIST_ITEMS).map((item, index) =>
      normalizeListItem(item, `${context}.items[${index}]`),
    ),
    emptyText: string(input.emptyText, `${context}.emptyText`, true),
    searchable: input.searchable === true,
    searchPlaceholder: string(input.searchPlaceholder, `${context}.searchPlaceholder`, true),
    timeline: input.timeline === true,
  };
}

function normalizeFormField(input: unknown, context: string): PluginFormField {
  const value = record(input, context);
  const kind = string(value.kind, `${context}.kind`);
  const id = string(value.id, `${context}.id`)!;
  const label = string(value.label, `${context}.label`)!;

  if (kind === "text") {
    return {
      kind,
      id,
      label,
      value: string(value.value, `${context}.value`, true),
      placeholder: string(value.placeholder, `${context}.placeholder`, true),
      helperText: string(value.helperText, `${context}.helperText`, true),
      inputMode: oneOf(
        value.inputMode,
        ["text", "email", "url", "password"] as const,
        "text",
        `${context}.inputMode`,
      ),
    };
  }
  if (kind === "textarea") {
    const rows = value.rows == null ? undefined : finiteNumber(value.rows, `${context}.rows`);
    return {
      kind,
      id,
      label,
      value: string(value.value, `${context}.value`, true),
      placeholder: string(value.placeholder, `${context}.placeholder`, true),
      helperText: string(value.helperText, `${context}.helperText`, true),
      rows: rows == null ? undefined : Math.min(20, Math.max(2, Math.floor(rows))),
    };
  }
  if (kind === "number") {
    return {
      kind,
      id,
      label,
      value: value.value == null ? undefined : finiteNumber(value.value, `${context}.value`),
      helperText: string(value.helperText, `${context}.helperText`, true),
      min: value.min == null ? undefined : finiteNumber(value.min, `${context}.min`),
      max: value.max == null ? undefined : finiteNumber(value.max, `${context}.max`),
      step: value.step == null ? undefined : finiteNumber(value.step, `${context}.step`),
    };
  }
  if (kind === "select" || kind === "choice") {
    const options = array(value.options, `${context}.options`, 100).map((option, index) => {
      const entry = record(option, `${context}.options[${index}]`);
      return {
        value: string(entry.value, `${context}.options[${index}].value`)!,
        label: string(entry.label, `${context}.options[${index}].label`)!,
        ...(kind === "choice"
          ? { icon: string(entry.icon, `${context}.options[${index}].icon`, true) }
          : {}),
      };
    });
    return {
      kind,
      id,
      label,
      value: string(value.value, `${context}.value`, true),
      options,
    } as PluginFormField;
  }
  if (kind === "toggle" || kind === "checkbox") {
    return {
      kind,
      id,
      label,
      value: value.value === true,
      ...(kind === "checkbox"
        ? { description: string(value.description, `${context}.description`, true) }
        : {}),
    } as PluginFormField;
  }
  throw new PluginViewError(`${context}.kind is not supported`);
}

function normalizeFormView(input: Record<string, unknown>, context: string): PluginFormView {
  if (typeof input.onSubmit !== "function") {
    throw new PluginViewError(`${context}.onSubmit must be a function`);
  }
  return {
    kind: "form",
    title: string(input.title, `${context}.title`, true),
    fields: array(input.fields, `${context}.fields`, MAX_FORM_FIELDS).map((field, index) =>
      normalizeFormField(field, `${context}.fields[${index}]`),
    ),
    submitLabel: string(input.submitLabel, `${context}.submitLabel`, true),
    onSubmit: input.onSubmit as PluginFormView["onSubmit"],
  };
}

function normalizeMetadataItem(input: unknown, context: string): PluginMetadataItem {
  const value = record(input, context);
  const kind = string(value.kind, `${context}.kind`);
  if (kind === "divider") return { kind };
  if (kind === "label") {
    return {
      kind,
      label: string(value.label, `${context}.label`)!,
      value: string(value.value, `${context}.value`)!,
      icon: string(value.icon, `${context}.icon`, true),
    };
  }
  if (kind === "tags") {
    return {
      kind,
      label: string(value.label, `${context}.label`)!,
      values: array(value.values, `${context}.values`, 30).map((tag, index) =>
        string(tag, `${context}.values[${index}]`)!,
      ),
    };
  }
  throw new PluginViewError(`${context}.kind is not supported`);
}

function normalizeColumnCell(input: unknown, context: string, depth: number): PluginColumnCell {
  const value = record(input, context);
  const weight = value.weight == null ? undefined : finiteNumber(value.weight, `${context}.weight`);
  return {
    weight: weight == null ? undefined : Math.min(4, Math.max(0.25, weight)),
    minWidth: oneOf(
      value.minWidth,
      ["compact", "standard", "wide"] as const,
      "standard",
      `${context}.minWidth`,
    ),
    blocks: normalizeBlocks(value.blocks, `${context}.blocks`, depth + 1),
  };
}

function normalizeDictionaryEntry(input: unknown, context: string): PluginDictionaryEntry {
  const value = record(input, context);
  return {
    headword: string(value.headword, `${context}.headword`)!,
    pronunciation: string(value.pronunciation, `${context}.pronunciation`, true),
    senses: array(value.senses, `${context}.senses`, 60).map((sense, index) => {
      const entry = record(sense, `${context}.senses[${index}]`);
      return {
        partOfSpeech: string(entry.partOfSpeech, `${context}.senses[${index}].partOfSpeech`)!,
        definition: string(entry.definition, `${context}.senses[${index}].definition`)!,
        examples: array(entry.examples, `${context}.senses[${index}].examples`, 30).map(
          (example, exampleIndex) =>
            string(
              example,
              `${context}.senses[${index}].examples[${exampleIndex}]`,
            )!,
        ),
      };
    }),
    etymology: string(value.etymology, `${context}.etymology`, true),
    contextualMeaning: string(value.contextualMeaning, `${context}.contextualMeaning`, true),
  };
}

function normalizeBlocks(value: unknown, context: string, depth: number): PluginBlock[] {
  if (depth > MAX_DEPTH) throw new PluginViewError(`${context} exceeds the ${MAX_DEPTH}-level limit`);
  return array(value, context, MAX_BLOCKS).map((block, index) =>
    normalizeBlock(block, `${context}[${index}]`, depth),
  );
}

function normalizeBlock(input: unknown, context: string, depth: number): PluginBlock {
  if (depth > MAX_DEPTH) throw new PluginViewError(`${context} exceeds the ${MAX_DEPTH}-level limit`);
  const value = record(input, context);
  const kind = string(value.kind, `${context}.kind`);

  if (kind === "markdown") return { kind, markdown: string(value.markdown, `${context}.markdown`)! };
  if (kind === "text") {
    return {
      kind,
      text: string(value.text, `${context}.text`)!,
      variant: oneOf(
        value.variant,
        ["body", "caption", "eyebrow", "heading"] as const,
        "body",
        `${context}.variant`,
      ),
      tone: oneOf(
        value.tone,
        ["default", "muted", "subtle"] as const,
        "default",
        `${context}.tone`,
      ),
    };
  }
  if (kind === "heading") {
    return {
      kind,
      text: string(value.text, `${context}.text`)!,
      caption: string(value.caption, `${context}.caption`, true),
    };
  }
  if (kind === "dictionary") {
    return { kind, entry: normalizeDictionaryEntry(value.entry, `${context}.entry`) };
  }
  if (kind === "keyValue") {
    return {
      kind,
      rows: array(value.rows, `${context}.rows`, 100).map((row, index) => {
        const entry = record(row, `${context}.rows[${index}]`);
        return {
          label: string(entry.label, `${context}.rows[${index}].label`)!,
          value: string(entry.value, `${context}.rows[${index}].value`)!,
        };
      }),
      layout: oneOf(
        value.layout,
        ["stacked", "inline"] as const,
        "inline",
        `${context}.layout`,
      ),
      columns: oneOf(value.columns, [1, 2, 3] as const, 1, `${context}.columns`),
    };
  }
  if (kind === "quote") {
    return {
      kind,
      text: string(value.text, `${context}.text`)!,
      caption: string(value.caption, `${context}.caption`, true),
    };
  }
  if (kind === "actions") {
    return {
      kind,
      actions: normalizeActions(value.actions, `${context}.actions`),
      align: oneOf(value.align, ["start", "end"] as const, "start", `${context}.align`),
    };
  }
  if (kind === "metric") {
    return {
      kind,
      label: string(value.label, `${context}.label`)!,
      value: string(value.value, `${context}.value`)!,
      description: string(value.description, `${context}.description`, true),
    };
  }
  if (kind === "progress") {
    return {
      kind,
      value: finiteNumber(value.value, `${context}.value`),
      max: value.max == null ? undefined : finiteNumber(value.max, `${context}.max`),
      label: string(value.label, `${context}.label`, true),
      showValue: value.showValue === true,
    };
  }
  if (kind === "tags") {
    return {
      kind,
      label: string(value.label, `${context}.label`, true),
      values: array(value.values, `${context}.values`, 40).map((tag, index) =>
        string(tag, `${context}.values[${index}]`)!,
      ),
    };
  }
  if (kind === "alert") {
    return {
      kind,
      title: string(value.title, `${context}.title`, true),
      message: string(value.message, `${context}.message`)!,
      variant: oneOf(
        value.variant,
        ["default", "destructive", "success"] as const,
        "default",
        `${context}.variant`,
      ),
    };
  }
  if (kind === "divider") return { kind };
  if (kind === "section" || kind === "group") {
    const blocks = normalizeBlocks(value.blocks, `${context}.blocks`, depth + 1);
    const gap = oneOf(
      value.gap,
      ["tight", "normal", "relaxed"] as const,
      "normal",
      `${context}.gap`,
    );
    return kind === "section"
      ? {
          kind,
          title: string(value.title, `${context}.title`, true),
          description: string(value.description, `${context}.description`, true),
          blocks,
          gap,
        }
      : { kind, blocks, gap };
  }
  if (kind === "columns") {
    const cells = array(value.cells, `${context}.cells`, 4);
    if (cells.length < 2) throw new PluginViewError(`${context}.cells needs 2–4 entries`);
    return {
      kind,
      cells: cells.map((cell, index) =>
        normalizeColumnCell(cell, `${context}.cells[${index}]`, depth),
      ),
      gap: oneOf(
        value.gap,
        ["tight", "normal", "relaxed"] as const,
        "normal",
        `${context}.gap`,
      ),
      align: oneOf(
        value.align,
        ["start", "center", "baseline", "stretch"] as const,
        "start",
        `${context}.align`,
      ),
    };
  }
  if (kind === "row") {
    const cells = array(value.cells, `${context}.cells`, 4);
    if (cells.length < 2) throw new PluginViewError(`${context}.cells needs 2–4 entries`);
    return {
      kind,
      cells: cells.map((cell, index) => {
        const entry = record(cell, `${context}.cells[${index}]`);
        const weight = entry.weight == null
          ? undefined
          : finiteNumber(entry.weight, `${context}.cells[${index}].weight`);
        return {
          weight: weight == null ? undefined : Math.min(4, Math.max(0.25, weight)),
          block: normalizeBlock(entry.block, `${context}.cells[${index}].block`, depth + 1),
        };
      }),
      align: oneOf(
        value.align,
        ["start", "center", "baseline"] as const,
        "start",
        `${context}.align`,
      ),
    };
  }
  if (kind === "list") return normalizeListView(value, context);
  if (kind === "form") return normalizeFormView(value, context);
  throw new PluginViewError(`${context}.kind "${kind}" is not supported`);
}

function normalizeDetailView(input: Record<string, unknown>, context: string): PluginDetailView {
  return {
    kind: "detail",
    title: string(input.title, `${context}.title`, true),
    content: normalizeBlocks(input.content, `${context}.content`, 0),
    metadata:
      input.metadata == null
        ? undefined
        : array(input.metadata, `${context}.metadata`, 60).map((item, index) =>
            normalizeMetadataItem(item, `${context}.metadata[${index}]`),
          ),
    controls:
      input.controls == null
        ? undefined
        : normalizeDetailControls(input.controls, `${context}.controls`),
    actions:
      input.actions == null ? undefined : normalizeActions(input.actions, `${context}.actions`),
  };
}

export function normalizePluginView(input: unknown): PluginView {
  const value = record(input, "view");
  const kind = string(value.kind, "view.kind");
  if (kind === "markdown") {
    return {
      kind,
      title: string(value.title, "view.title", true),
      markdown: string(value.markdown, "view.markdown")!,
    };
  }
  if (kind === "list") return normalizeListView(value, "view");
  if (kind === "form") return normalizeFormView(value, "view");
  if (kind === "blocks") {
    return {
      kind,
      title: string(value.title, "view.title", true),
      blocks: normalizeBlocks(value.blocks, "view.blocks", 0),
    };
  }
  if (kind === "detail") return normalizeDetailView(value, "view");
  throw new PluginViewError(`view.kind "${kind}" is not supported`);
}
