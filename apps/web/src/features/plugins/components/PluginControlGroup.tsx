import { CaretDown, Check } from "@phosphor-icons/react";
import { DropdownMenu, Stack } from "@read-aware/ui";
import type { PluginDetailControl } from "../lib/plugin-types";
import { renderPluginIcon } from "../lib/plugin-icons";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginControlGroupProps = {
  controls: PluginDetailControl[];
  busy: boolean;
  onResult: PluginResultRunner;
};

/** Host-owned rendering for compact semantic controls declared by plugins. */
export function PluginControlGroup({
  controls,
  busy,
  onResult,
}: PluginControlGroupProps) {
  return (
    <Stack direction="horizontal" gap="sm" align="center" justify="end" wrap>
      {controls.map((control) => {
        const selected =
          control.options.find((option) => option.value === control.value) ?? control.options[0];
        return (
          <DropdownMenu
            key={control.id}
            align="right"
            triggerLabel={`${control.label}: ${selected.label}`}
            trigger={
              <span className="inline-flex min-h-7 max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-subtle transition-colors hover:text-fg">
                {renderPluginIcon(control.icon, 14)}
                <span className="truncate">{selected.label}</span>
                <CaretDown size={10} aria-hidden="true" />
              </span>
            }
            items={control.options.map((option) => ({
              label: option.label,
              disabled: busy,
              icon:
                option.value === control.value ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <span className="inline-block w-[14px]" aria-hidden="true" />
                ),
              onClick: () => {
                if (option.value !== control.value) {
                  void onResult(() => control.onChange(option.value));
                }
              },
            }))}
          />
        );
      })}
    </Stack>
  );
}
