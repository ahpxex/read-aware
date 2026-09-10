import { DotsThreeVertical } from "@phosphor-icons/react";
import { DropdownMenu } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { ContextActionInput } from "../lib/plugin-types";
import { usePluginContextItems } from "../hooks/usePluginContextItems";

export function PluginContextMenu({ input, className }: { input: ContextActionInput; className?: string }) {
  const { t } = useTranslation("plugins");
  const items = usePluginContextItems(input);
  if (!items.length) return null;
  return <DropdownMenu
    items={items}
    align="right"
    className={className}
    triggerLabel={t("menu.actions")}
    trigger={<span className="flex h-8 w-8 items-center justify-center rounded-md bg-paper text-fg-muted hover:text-fg">
      <DotsThreeVertical size={18} aria-hidden="true" />
    </span>}
  />;
}
