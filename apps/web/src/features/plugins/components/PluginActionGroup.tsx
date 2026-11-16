import { DotsThree } from "@phosphor-icons/react";
import { Button, buttonClassName, DropdownMenu, Stack } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { renderPluginIcon } from "../lib/plugin-icons";
import { splitToolbarActions } from "../lib/plugin-actions";
import type { PluginAction } from "../lib/plugin-types";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginActionGroupProps = {
  actions: PluginAction[];
  busy: boolean;
  align?: "start" | "end";
  /**
   * `buttons`: every action as a labeled button — dialog footers and inline
   * `actions` blocks, where the plugin composes the row itself.
   * `toolbar`: a view-level command row — primary actions inline as labeled
   * buttons, everything else behind one "More" menu, so a long action list
   * never becomes a strip of icon-only buttons.
   */
  display?: "buttons" | "toolbar";
  onResult: PluginResultRunner;
};

export function PluginActionGroup({
  actions,
  busy,
  align = "start",
  display = "buttons",
  onResult,
}: PluginActionGroupProps) {
  const { t } = useTranslation("plugins");
  const { inline, overflow } =
    display === "toolbar" ? splitToolbarActions(actions) : { inline: actions, overflow: [] as PluginAction[] };

  return (
    <Stack direction="horizontal" gap="sm" align="center" justify={align === "end" ? "end" : "start"} wrap>
      {inline.map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant={action.variant ?? "outline"}
          disabled={busy || action.disabled}
          onClick={() => void onResult(action.run)}
        >
          {action.icon && renderPluginIcon(action.icon, 14)}
          {action.label}
        </Button>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu
          align={align === "end" ? "right" : "left"}
          triggerLabel={t("viewer.more")}
          trigger={
            // The "More" control sits in the same row as the labeled outline
            // buttons, so it borrows the Button look verbatim (corners
            // included) instead of a hand-rolled bordered square.
            <span
              className={buttonClassName({
                variant: "outline",
                size: "sm",
                className: cn("w-8 px-0", busy && "pointer-events-none opacity-40"),
              })}
              aria-disabled={busy || undefined}
            >
              <DotsThree size={18} weight="bold" aria-hidden="true" />
            </span>
          }
          items={overflow.map((action) => ({
            label: action.label,
            icon: action.icon ? renderPluginIcon(action.icon, 15) : undefined,
            destructive: action.variant === "danger",
            disabled: busy || action.disabled,
            onClick: () => void onResult(action.run),
          }))}
        />
      )}
    </Stack>
  );
}
