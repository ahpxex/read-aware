import { Sparkle, X } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { useLocale, useTranslation } from "../../../i18n";
import { useWhatsNewNotice } from "../hooks/useWhatsNewNotice";
import { changelogUrlForLocale } from "../lib/whats-new";

/**
 * 升级完成后的"看看更新了什么"入口，与 UpdateIndicator 同住导航前部。
 * 点击跳官网更新日志（按 app 语言选路由）并就地关闭；也可手动 X 掉，
 * 或放着等 48 小时自然过期。
 */
export function WhatsNewNotice() {
  const { t } = useTranslation("nav");
  const locale = useLocale();
  const { notice, dismiss } = useWhatsNewNotice();

  if (!notice) return null;

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <a
        href={changelogUrlForLocale(locale)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={dismiss}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-caption text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      >
        <Sparkle size={14} weight="regular" aria-hidden="true" />
        <span>{t("update.whatsNew", { version: notice.version })}</span>
      </a>
      <Tooltip content={t("update.whatsNewDismiss")} side="bottom">
        <IconButton
          size="sm"
          label={t("update.whatsNewDismiss")}
          onClick={dismiss}
          className="h-6 w-6 rounded-md text-fg-subtle hover:bg-fg/5 hover:text-fg focus-visible:ring-fg"
          icon={<X size={12} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    </span>
  );
}
