/**
 * Renders the plugin view vocabulary (markdown / list / form) with the app's
 * own design system, plus the chaining stack: a list item or form submit that
 * returns `{ view }` pushes a detail view with a back affordance
 * (docs/plugin-system.md §6). Containers (Popover / Dialog / Page) wrap this.
 */
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Body, Button, IconButton, Select, Spinner, TextArea, TextField, Toggle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { Markdown } from "../../ai/components/Markdown";
import { DictionaryEntryBody } from "../../reader/components/DictionaryEntryBody";
import { showPluginToast } from "../lib/plugin-toast";
import { renderPluginIcon } from "../lib/plugin-icons";
import type {
  PluginBlock,
  PluginFormValues,
  PluginFormView,
  PluginListView,
  PluginView,
  PluginViewResult,
} from "../lib/plugin-types";

type PluginViewRendererProps = {
  /** The root view, or null while the container is still fetching it. */
  view: PluginView | null;
  /** Handles `{ close: true }` results (dismiss the hosting container). */
  onClose?: () => void;
  className?: string;
};

export function PluginViewRenderer({ view, onClose, className }: PluginViewRendererProps) {
  const { t } = useTranslation("plugins");
  const [stack, setStack] = useState<PluginView[]>(view ? [view] : []);
  const [busy, setBusy] = useState(false);

  // A new root view resets the chain (the container fetched fresh content).
  useEffect(() => {
    setStack(view ? [view] : []);
    setBusy(false);
  }, [view]);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  async function handleResult(
    run: () => PluginViewResult | Promise<PluginViewResult>,
  ): Promise<PluginViewResult> {
    setBusy(true);
    try {
      const result = await run();
      if (result) {
        if (result.toast) showPluginToast(result.toast);
        // Field errors keep the form open; nothing else happens this round.
        if (!result.fieldErrors) {
          if (result.view) {
            const next = result.view;
            setStack((prev) => [...prev, next]);
          } else if (result.close) {
            onClose?.();
          }
        }
      }
      return result;
    } catch (error) {
      showPluginToast(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!current) {
    return (
      <div className={cn("flex items-center justify-center py-10", className)}>
        <Spinner size="sm" label={t("viewer.loading")} />
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {(stack.length > 1 || current.title) && (
        <div className="mb-2 flex shrink-0 items-center gap-1">
          {stack.length > 1 && (
            <IconButton
              label={t("viewer.back")}
              size="sm"
              onClick={() => setStack((prev) => prev.slice(0, -1))}
              className="text-fg-muted hover:text-fg"
              icon={<CaretLeft size={16} weight="regular" aria-hidden="true" />}
            />
          )}
          {current.title && (
            <Body className="truncate text-sm font-semibold text-fg">{current.title}</Body>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {current.kind === "markdown" && (
          <Markdown className="text-sm leading-6">{current.markdown}</Markdown>
        )}
        {current.kind === "list" && (
          <PluginListViewBody view={current} busy={busy} onResult={handleResult} />
        )}
        {current.kind === "form" && (
          // Remount per stack depth so field state never leaks between views.
          <PluginFormViewBody
            key={stack.length}
            view={current}
            busy={busy}
            onResult={handleResult}
          />
        )}
        {current.kind === "blocks" && (
          <div className="flex flex-col gap-4">
            {current.blocks.map((block, index) => (
              <PluginBlockBody
                key={index}
                block={block}
                stackDepth={stack.length}
                busy={busy}
                onResult={handleResult}
              />
            ))}
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--ra-main-surface-color)]/60">
            <Spinner size="sm" />
          </div>
        )}
      </div>
    </div>
  );
}

function PluginBlockBody({
  block,
  stackDepth,
  busy,
  onResult,
}: {
  block: PluginBlock;
  stackDepth: number;
  busy: boolean;
  onResult: (run: () => PluginViewResult | Promise<PluginViewResult>) => void;
}) {
  if (block.kind === "markdown") {
    return <Markdown className="text-sm leading-6">{block.markdown}</Markdown>;
  }
  if (block.kind === "heading") {
    return (
      <div className="flex flex-col gap-0.5 pt-1">
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
          {block.text}
        </span>
        {block.caption && (
          <span className="font-sans text-xs text-fg-muted">{block.caption}</span>
        )}
      </div>
    );
  }
  if (block.kind === "dictionary") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="font-serif text-xl font-medium text-fg">
            {block.entry.headword}
          </span>
          {block.entry.pronunciation && (
            <span className="font-mono text-xs text-fg-subtle">
              {block.entry.pronunciation}
            </span>
          )}
        </div>
        <DictionaryEntryBody entry={block.entry} />
      </div>
    );
  }
  if (block.kind === "keyValue") {
    return (
      <dl className="flex flex-col gap-1">
        {block.rows.map((row, index) => (
          <div key={index} className="flex gap-3 text-sm">
            <dt className="w-24 shrink-0 text-fg-subtle">{row.label}</dt>
            <dd className="min-w-0 flex-1 text-fg">{row.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (block.kind === "quote") {
    return (
      <figure className="border-l-2 border-border pl-3">
        <blockquote className="font-serif text-sm italic leading-relaxed text-fg-muted">
          {block.text}
        </blockquote>
        {block.caption && (
          <figcaption className="mt-1 text-xs text-fg-subtle">{block.caption}</figcaption>
        )}
      </figure>
    );
  }
  if (block.kind === "actions") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {block.actions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.variant ?? "outline"}
            disabled={busy}
            onClick={() => onResult(action.run)}
          >
            {action.icon && (
              <span className="mr-1 inline-flex">{renderPluginIcon(action.icon, 14)}</span>
            )}
            {action.label}
          </Button>
        ))}
      </div>
    );
  }
  if (block.kind === "divider") {
    return <hr className="border-border" />;
  }
  if (block.kind === "row") {
    // 2–4 cells side by side; weights size the columns. flex-wrap + a per-cell
    // min-width is what makes it self-collapse into a stack on a narrow
    // container (each cell then takes the full row) — no media query needed,
    // so it degrades by the surface's actual width, not the viewport's.
    const cells = block.cells.slice(0, 4);
    const alignClass =
      block.align === "center"
        ? "items-center"
        : block.align === "baseline"
          ? "items-baseline"
          : "items-start";
    return (
      <div className={cn("flex flex-wrap gap-4", alignClass)}>
        {cells.map((cell, index) => {
          const weight = Math.max(0, cell.weight ?? 1);
          return (
            <div
              key={index}
              className="min-w-[8rem] flex-[var(--ra-cell-grow)] basis-0"
              style={{ ["--ra-cell-grow" as string]: `${weight}` }}
            >
              <PluginBlockBody
                block={cell.block}
                stackDepth={stackDepth}
                busy={busy}
                onResult={onResult}
              />
            </div>
          );
        })}
      </div>
    );
  }
  if (block.kind === "list") {
    return <PluginListViewBody view={block} busy={busy} onResult={onResult} />;
  }
  return <PluginFormViewBody key={stackDepth} view={block} busy={busy} onResult={onResult} />;
}

function PluginListViewBody({
  view,
  busy,
  onResult,
}: {
  view: PluginListView;
  busy: boolean;
  onResult: (run: () => PluginViewResult | Promise<PluginViewResult>) => Promise<PluginViewResult> | void;
}) {
  const { t } = useTranslation("plugins");
  if (view.items.length === 0) {
    return (
      <Body className="px-1 py-4 text-sm text-fg-muted">
        {view.emptyText ?? t("viewer.empty")}
      </Body>
    );
  }
  return (
    <ul className="flex flex-col">
      {view.items.map((item) => {
        const interactive = typeof item.onSelect === "function";
        const row = (
          <>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-fg-muted">
              {renderPluginIcon(item.icon, 15)}
            </span>
            <span className="min-w-0 flex-1">
              <Body as="span" className="block truncate text-sm text-fg">
                {item.title}
              </Body>
              {item.subtitle && (
                <span className="block truncate text-xs text-fg-subtle">{item.subtitle}</span>
              )}
            </span>
            {interactive && (
              <CaretRight size={14} className="shrink-0 text-fg-subtle" aria-hidden="true" />
            )}
          </>
        );
        return (
          <li key={item.id} className="border-b border-border/60 last:border-b-0">
            {interactive ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onResult(() => item.onSelect!())}
                className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg disabled:opacity-60"
              >
                {row}
              </button>
            ) : (
              <div className="flex w-full items-center gap-2.5 px-1.5 py-2">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PluginFormViewBody({
  view,
  busy,
  onResult,
}: {
  view: PluginFormView;
  busy: boolean;
  onResult: (run: () => PluginViewResult | Promise<PluginViewResult>) => Promise<PluginViewResult> | void;
}) {
  const { t } = useTranslation("plugins");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<PluginFormValues>(() => {
    const initial: PluginFormValues = {};
    for (const field of view.fields) {
      initial[field.id] =
        field.kind === "toggle"
          ? (field.value ?? false)
          : field.kind === "number"
            ? (field.value ?? 0)
            : (field.value ?? "");
    }
    return initial;
  });

  return (
    <form
      className="flex flex-col gap-4 px-0.5 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        void (async () => {
          const result = await onResult(() => view.onSubmit({ ...values }));
          if (result?.fieldErrors) setErrors(result.fieldErrors);
        })();
      }}
    >
      {view.fields.map((field) => {
        if (field.kind === "text") {
          return (
            <TextField
              key={field.id}
              label={field.label}
              variant="outlined"
              placeholder={field.placeholder}
              error={errors[field.id]}
              value={String(values[field.id] ?? "")}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.id]: event.target.value }))
              }
            />
          );
        }
        if (field.kind === "textarea") {
          return (
            <TextArea
              key={field.id}
              label={field.label}
              placeholder={field.placeholder}
              rows={field.rows ?? 4}
              error={errors[field.id]}
              value={String(values[field.id] ?? "")}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.id]: event.target.value }))
              }
            />
          );
        }
        if (field.kind === "number") {
          return (
            <TextField
              key={field.id}
              label={field.label}
              variant="outlined"
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              error={errors[field.id]}
              value={String(values[field.id] ?? 0)}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.id]: Number(event.target.value) }))
              }
            />
          );
        }
        if (field.kind === "select") {
          return (
            <Select
              key={field.id}
              label={field.label}
              variant="outlined"
              options={field.options}
              value={String(values[field.id] ?? "")}
              onChange={(value) => setValues((prev) => ({ ...prev, [field.id]: value }))}
            />
          );
        }
        return (
          <Toggle
            key={field.id}
            label={field.label}
            checked={values[field.id] === true}
            onChange={(checked) => setValues((prev) => ({ ...prev, [field.id]: checked }))}
          />
        );
      })}
      <div className="flex justify-end pt-1">
        <Button type="submit" size="sm" disabled={busy}>
          {view.submitLabel ?? t("viewer.submit")}
        </Button>
      </div>
    </form>
  );
}
