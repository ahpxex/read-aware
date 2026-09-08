/** Host renderer for the declarative plugin component vocabulary. */
import { CaretLeft } from "@phosphor-icons/react";
import { useEffect } from "react";
import {
  InlineError,
  Body,
  Button,
  Dialog,
  Divider,
  IconButton,
  ScrollArea,
  Spinner,
  Stack,
} from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { Markdown } from "../../ai/components/Markdown";
import type { PluginView } from "../lib/plugin-types";
import type { PluginViewSession } from "../lib/plugin-view-session";
import { usePluginViewSession } from "../hooks/usePluginViewSession";
import { PluginBlocks } from "./PluginBlockRenderer";
import { PluginActionGroup } from "./PluginActionGroup";
import { PluginDetailViewBody } from "./PluginDetailViewBody";
import { PluginFormViewBody } from "./PluginFormViewBody";
import { PluginListViewBody } from "./PluginListViewBody";

type PluginViewRendererProps = {
  /** The root view, or null while the container is still fetching it. */
  view?: PluginView | null;
  /** Nested dialogs borrow a session owned by their parent's navigation. */
  session?: PluginViewSession;
  /** Handles `{ close: true }` results (dismiss the hosting container). */
  onClose?: () => void;
  /** Reports host-owned navigation depth so page chrome can follow the view. */
  onDepthChange?: (depth: number) => void;
  /** Refetches the owning root after a modal detail closes. */
  onRequestRefresh?: () => void;
  /** Adds host Close + detail actions in a fixed dialog footer. */
  dialogFooter?: boolean;
  /** Stable identity of the hosting view; lets a timeline persist its tab. */
  viewStateKey?: string;
  /**
   * `contained` (default) scrolls the view inside its own bounded ScrollArea
   * — for dialogs and popups, whose scrollbar belongs at the container edge.
   * `flow` renders in normal flow for full-page surfaces: the page's own
   * scroll viewport does the scrolling and keeps the scrollbar at its edge.
   */
  scroll?: "contained" | "flow";
  className?: string;
};

export function PluginViewRenderer({
  view = null,
  session: provided,
  onClose,
  onDepthChange,
  onRequestRefresh,
  dialogFooter = false,
  viewStateKey,
  scroll = "contained",
  className,
}: PluginViewRendererProps) {
  const { t } = useTranslation(["plugins", "common"]);
  const { session, stack, error: viewError, busy, dialog: detailDialog } = usePluginViewSession(view, provided, onClose, onRequestRefresh);

  useEffect(() => {
    onDepthChange?.(stack.length);
  }, [onDepthChange, stack.length]);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  const closeDetailDialog = () => session.closeDialog(true);
  const handleResult = session.run;

  if (viewError) {
    return (
      <InlineError className={className}>{t("viewer.invalidView")}</InlineError>
    );
  }

  if (!current) {
    return (
      <Stack align="center" justify="center" className={cn("py-10", className)}>
        <Spinner size="sm" label={t("viewer.loading")} />
      </Stack>
    );
  }

  const currentView = (
    <>
      {current.kind === "markdown" && (
        <Markdown>{current.markdown}</Markdown>
      )}
      {current.kind === "list" && (
        <PluginListViewBody
          view={current}
          busy={busy}
          onResult={handleResult}
          // Only the root list owns the view's identity; pushed sub-lists get
          // no key and fall back to the default range.
          viewStateKey={stack.length === 1 ? viewStateKey : undefined}
        />
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
          showActions={!dialogFooter}
          metadataPresentation={dialogFooter ? "header" : "footer"}
          scrollBody={dialogFooter}
        />
      )}
    </>
  );
  const busyOverlay = busy ? (
    <Stack
      align="center"
      justify="center"
      className="absolute inset-0 bg-[var(--ra-main-surface-color)]/70"
    >
      <Spinner size="sm" />
    </Stack>
  ) : null;

  return (
    <>
      <Stack gap="sm" className={cn("min-h-0", className)}>
        {(stack.length > 1 || current.title) && (
          <Stack direction="horizontal" gap="xs" align="center" className="shrink-0">
            {stack.length > 1 && (
              <IconButton
                label={t("viewer.back")}
                size="sm"
                onClick={session.back}
                className="text-fg-muted hover:text-fg"
                icon={<CaretLeft size={16} weight="regular" aria-hidden="true" />}
              />
            )}
            {current.title && (
              <Body className="truncate text-sm font-semibold text-fg">{current.title}</Body>
            )}
          </Stack>
        )}

        {dialogFooter && current.kind === "detail" ? (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {currentView}
            {busyOverlay}
          </div>
        ) : scroll === "flow" ? (
          <div className="relative">
            {currentView}
            {busyOverlay}
          </div>
        ) : (
          <ScrollArea className="relative min-h-0 flex-1">
            {currentView}
            {busyOverlay}
          </ScrollArea>
        )}

        {dialogFooter && (
          <Stack gap="md" className="shrink-0 pt-2">
            <Divider />
            <Stack direction="horizontal" gap="sm" align="center" justify="end" wrap>
              {current.kind === "detail" && current.actions && current.actions.length > 0 && (
                <PluginActionGroup
                  actions={current.actions}
                  busy={busy}
                  display="buttons"
                  onResult={handleResult}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={session.close}
              >
                {t("viewer.close")}
              </Button>
            </Stack>
          </Stack>
        )}
      </Stack>

      <Dialog
        open={detailDialog !== null}
        onClose={closeDetailDialog}
        aria-label={detailDialog?.title || t("viewer.detail")}
        className="max-h-[85vh] w-[min(90vw,36rem)]"
      >
        {detailDialog && (
          <PluginViewRenderer
            key={detailDialog.requestId}
            session={detailDialog.session}
            onClose={closeDetailDialog}
            dialogFooter
            className="max-h-[calc(85vh-4rem)]"
          />
        )}
      </Dialog>
    </>
  );
}
