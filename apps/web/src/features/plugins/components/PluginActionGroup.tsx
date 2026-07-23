import { Button, IconButton, Stack, Tooltip } from "@read-aware/ui";
import { renderPluginIcon } from "../lib/plugin-icons";
import type { PluginAction } from "../lib/plugin-types";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginActionGroupProps = {
  actions: PluginAction[];
  busy: boolean;
  align?: "start" | "end";
  display?: "buttons" | "icons";
  onResult: PluginResultRunner;
};

export function PluginActionGroup({
  actions,
  busy,
  align = "start",
  display = "buttons",
  onResult,
}: PluginActionGroupProps) {
  return (
    <Stack
      direction="horizontal"
      gap="sm"
      align="center"
      justify={align === "end" ? "end" : "start"}
      wrap
    >
      {actions.map((action) => {
        if (display === "icons") {
          return (
            <Tooltip key={action.id} content={action.label} align="end">
              <IconButton
                label={action.label}
                size="sm"
                tone={action.variant === "danger" ? "danger" : "default"}
                icon={renderPluginIcon(action.icon, 16)}
                disabled={busy}
                onClick={() => void onResult(action.run)}
              />
            </Tooltip>
          );
        }

        return (
          <Button
            key={action.id}
            size="sm"
            variant={action.variant ?? "outline"}
            disabled={busy}
            onClick={() => void onResult(action.run)}
          >
            {action.icon && renderPluginIcon(action.icon, 14)}
            {action.label}
          </Button>
        );
      })}
    </Stack>
  );
}
