/**
 * Renders the plugin view vocabulary (markdown / list / form) with the app's
 * own design system, plus the chaining stack: a list item or form submit that
 * returns `{ view }` pushes a detail view with a back affordance
 * (docs/plugin-system.md §6). Containers (Popover / Dialog / Page) wrap this.
 */
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Body, Button, IconButton, Select, Spinner, TextField, Toggle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { Markdown } from "../../ai/components/Markdown";
import { showPluginToast } from "../lib/plugin-toast";
import { renderPluginIcon } from "../lib/plugin-icons";
import type {
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

  async function handleResult(run: () => PluginViewResult | Promise<PluginViewResult>) {
    setBusy(true);
    try {
      const result = await run();
      if (result) {
        if (result.toast) showPluginToast(result.toast);
        if (result.view) {
          const next = result.view;
          setStack((prev) => [...prev, next]);
        } else if (result.close) {
          onClose?.();
        }
      }
    } catch (error) {
      showPluginToast(error instanceof Error ? error.message : String(error));
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
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--ra-main-surface-color)]/60">
            <Spinner size="sm" />
          </div>
        )}
      </div>
    </div>
  );
}

function PluginListViewBody({
  view,
  busy,
  onResult,
}: {
  view: PluginListView;
  busy: boolean;
  onResult: (run: () => PluginViewResult | Promise<PluginViewResult>) => void;
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
  onResult: (run: () => PluginViewResult | Promise<PluginViewResult>) => void;
}) {
  const { t } = useTranslation("plugins");
  const [values, setValues] = useState<PluginFormValues>(() => {
    const initial: PluginFormValues = {};
    for (const field of view.fields) {
      initial[field.id] = field.kind === "toggle" ? (field.value ?? false) : (field.value ?? "");
    }
    return initial;
  });

  return (
    <form
      className="flex flex-col gap-4 px-0.5 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        onResult(() => view.onSubmit({ ...values }));
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
              value={String(values[field.id] ?? "")}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.id]: event.target.value }))
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
