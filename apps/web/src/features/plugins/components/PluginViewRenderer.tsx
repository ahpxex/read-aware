/** Host renderer for the declarative plugin component vocabulary. */
import { CaretLeft } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Alert, Body, Dialog, IconButton, ScrollArea, Spinner, Stack } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { Markdown } from "../../ai/components/Markdown";
import {
  navigatePluginViewStack,
  normalizePluginView,
  PluginViewError,
} from "../lib/plugin-view";
import { showPluginToast } from "../lib/plugin-toast";
import type { PluginView, PluginViewResult } from "../lib/plugin-types";
import { PluginBlocks } from "./PluginBlockRenderer";
import { PluginDetailViewBody } from "./PluginDetailViewBody";
import { PluginFormViewBody } from "./PluginFormViewBody";
import { PluginListViewBody } from "./PluginListViewBody";
import type { PluginResultOptions, PluginResultRunner } from "./plugin-view-types";

type PluginViewRendererProps = {
  /** The root view, or null while the container is still fetching it. */
  view: PluginView | null;
  /** Handles `{ close: true }` results (dismiss the hosting container). */
  onClose?: () => void;
  /** Reports host-owned navigation depth so page chrome can follow the view. */
  onDepthChange?: (depth: number) => void;
  /** Refetches the owning root after a modal detail closes. */
  onRequestRefresh?: () => void;
  className?: string;
};

type DetailDialogState = {
  requestId: number;
  title: string;
  view: PluginView | null;
};

function normalizeSafely(view: PluginView | null): { view: PluginView | null; error: string | null } {
  if (!view) return { view: null, error: null };
  try {
    return { view: normalizePluginView(view), error: null };
  } catch (error) {
    return {
      view: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function PluginViewRenderer({
  view,
  onClose,
  onDepthChange,
  onRequestRefresh,
  className,
}: PluginViewRendererProps) {
  const { t } = useTranslation("plugins");
  const initial = normalizeSafely(view);
  const [stack, setStack] = useState<PluginView[]>(initial.view ? [initial.view] : []);
  const [viewError, setViewError] = useState<string | null>(initial.error);
  const [busy, setBusy] = useState(false);
  const [detailDialog, setDetailDialog] = useState<DetailDialogState | null>(null);
  const dialogRequestIdRef = useRef(0);

  useEffect(() => {
    dialogRequestIdRef.current += 1;
    const next = normalizeSafely(view);
    setStack(next.view ? [next.view] : []);
    setViewError(next.error);
    setBusy(false);
    setDetailDialog(null);
  }, [view]);

  useEffect(() => {
    onDepthChange?.(stack.length);
  }, [onDepthChange, stack.length]);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  const closeDetailDialog = () => {
    dialogRequestIdRef.current += 1;
    setDetailDialog(null);
    onRequestRefresh?.();
  };

  const handleResult: PluginResultRunner = async (
    run,
    options?: PluginResultOptions,
  ) => {
    const opensDialog = options?.presentation === "dialog";
    const requestId = opensDialog ? ++dialogRequestIdRef.current : 0;
    if (opensDialog) {
      setDetailDialog({
        requestId,
        title: options?.dialogTitle ?? t("viewer.detail"),
        view: null,
      });
    } else {
      setBusy(true);
    }

    try {
      const result = await run();
      if (result == null) {
        if (opensDialog) {
          setDetailDialog((current) => current?.requestId === requestId ? null : current);
        }
        return result;
      }
      if (typeof result !== "object" || Array.isArray(result)) {
        throw new PluginViewError("plugin action results must be objects");
      }
      if (result.toast) showPluginToast(String(result.toast));
      if (!result.fieldErrors) {
        if (result.view) {
          const next = normalizePluginView(result.view);
          if (opensDialog) {
            setDetailDialog((dialog) =>
              dialog?.requestId === requestId ? { ...dialog, view: next } : dialog,
            );
          } else {
            setStack((previous) => navigatePluginViewStack(previous, next, result.navigation));
          }
        } else if (result.navigation) {
          throw new PluginViewError("plugin navigation requires a view");
        } else if (result.close) {
          if (opensDialog) {
            setDetailDialog((dialog) =>
              dialog?.requestId === requestId ? null : dialog,
            );
          }
          else onClose?.();
        } else if (opensDialog) {
          setDetailDialog((current) => current?.requestId === requestId ? null : current);
        }
      } else if (opensDialog) {
        throw new PluginViewError("dialog list items cannot return form field errors");
      }
      return result as PluginViewResult;
    } catch (error) {
      if (opensDialog) {
        setDetailDialog((current) => current?.requestId === requestId ? null : current);
      }
      showPluginToast(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      if (!opensDialog) setBusy(false);
    }
  };

  if (viewError) {
    return (
      <Alert variant="destructive" title={t("viewer.invalidView")} className={className}>
        {viewError}
      </Alert>
    );
  }

  if (!current) {
    return (
      <Stack align="center" justify="center" className={cn("py-10", className)}>
        <Spinner size="sm" label={t("viewer.loading")} />
      </Stack>
    );
  }

  return (
    <>
      <Stack gap="sm" className={cn("min-h-0", className)}>
        {(stack.length > 1 || current.title) && (
          <Stack direction="horizontal" gap="xs" align="center" className="shrink-0">
            {stack.length > 1 && (
              <IconButton
                label={t("viewer.back")}
                size="sm"
                onClick={() => setStack((previous) => previous.slice(0, -1))}
                className="text-fg-muted hover:text-fg"
                icon={<CaretLeft size={16} weight="regular" aria-hidden="true" />}
              />
            )}
            {current.title && (
              <Body className="truncate text-sm font-semibold text-fg">{current.title}</Body>
            )}
          </Stack>
        )}

        <ScrollArea className="relative min-h-0 flex-1">
          {current.kind === "markdown" && (
            <Markdown className="text-sm leading-6">{current.markdown}</Markdown>
          )}
          {current.kind === "list" && (
            <PluginListViewBody view={current} busy={busy} onResult={handleResult} />
          )}
          {current.kind === "form" && (
            <PluginFormViewBody
              key={stack.length}
              view={current}
              busy={busy}
              onResult={handleResult}
            />
          )}
          {current.kind === "blocks" && (
            <PluginBlocks
              blocks={current.blocks}
              stackDepth={stack.length}
              busy={busy}
              onResult={handleResult}
            />
          )}
          {current.kind === "detail" && (
            <PluginDetailViewBody
              view={current}
              stackDepth={stack.length}
              busy={busy}
              onResult={handleResult}
            />
          )}
          {busy && (
            <Stack
              align="center"
              justify="center"
              className="absolute inset-0 bg-[var(--ra-main-surface-color)]/70"
            >
              <Spinner size="sm" />
            </Stack>
          )}
        </ScrollArea>
      </Stack>

      <Dialog
        open={detailDialog !== null}
        onClose={closeDetailDialog}
        aria-label={detailDialog?.title ?? t("viewer.detail")}
        className="max-h-[85vh] w-[min(90vw,36rem)] overflow-y-auto overscroll-none"
      >
        {detailDialog && (
          <PluginViewRenderer
            view={detailDialog.view}
            onClose={closeDetailDialog}
            className="max-h-[calc(85vh-4rem)]"
          />
        )}
      </Dialog>
    </>
  );
}
