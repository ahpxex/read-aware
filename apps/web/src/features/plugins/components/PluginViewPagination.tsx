import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { Caption, IconButton, Stack, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { PluginViewPagination as Pagination } from "../lib/plugin-types";
import type { PluginResultRunner } from "./plugin-view-types";

export function PluginViewPagination({ pagination, busy, onResult }: {
  pagination?: Pagination;
  busy: boolean;
  onResult: PluginResultRunner;
}) {
  const { t } = useTranslation("plugins");
  if (!pagination) return null;
  return (
    <Stack direction="horizontal" gap="sm" align="center" justify="end" className="min-h-9">
      <Tooltip content={t("viewer.pagination.previous")} align="start">
        <IconButton label={t("viewer.pagination.previous")} size="sm"
          icon={<CaretLeft size={16} aria-hidden="true" />}
          disabled={busy || !pagination.onPrevious}
          onClick={() => { if (pagination.onPrevious) void onResult(pagination.onPrevious, { navigation: "replace" }); }} />
      </Tooltip>
      <Caption role="status" className="min-w-20 break-words text-center tabular-nums">
        {pagination.pageCount === undefined
          ? t("viewer.pagination.page", { page: pagination.page })
          : t("viewer.pagination.pageOf", { page: pagination.page, total: pagination.pageCount })}
      </Caption>
      <Tooltip content={t("viewer.pagination.next")} align="end">
        <IconButton label={t("viewer.pagination.next")} size="sm"
          icon={<CaretRight size={16} aria-hidden="true" />}
          disabled={busy || !pagination.onNext}
          onClick={() => { if (pagination.onNext) void onResult(pagination.onNext, { navigation: "replace" }); }} />
      </Tooltip>
    </Stack>
  );
}
