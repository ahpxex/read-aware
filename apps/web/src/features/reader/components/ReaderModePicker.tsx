import { useState } from "react";
import { ListChecks } from "@phosphor-icons/react";
import type { ReadingModeSnapshot } from "@read-aware/core";
import { Popover, Select, Spinner, iconButtonClassName } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";

export function ReaderModePicker({
  mode,
  select,
  busy,
  variant = "icon",
}: {
  mode: ReadingModeSnapshot;
  select(key: string): Promise<boolean>;
  busy: boolean;
  /** "toolbar": a phone bottom-toolbar slot whose panel opens upward. */
  variant?: "icon" | "toolbar";
}) {
  const { t } = useTranslation("reader");
  const [open, setOpen] = useState(false);
  const toolbar = variant === "toolbar";
  return (
    <Popover
      align="right"
      side={toolbar ? "top" : "bottom"}
      open={open}
      onOpenChange={setOpen}
      triggerLabel={t("modeProvider")}
      triggerTooltip={toolbar ? undefined : t("modeProvider")}
      trigger={<ListChecks size={toolbar ? 20 : 18} aria-hidden="true" />}
      className={cn("pointer-events-auto", toolbar && "block w-full")}
      triggerClassName={
        toolbar
          ? cn(iconButtonClassName({ size: "toolbar" }), open && "text-fg")
          : "h-7 w-7 items-center justify-center rounded-control text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      }
      panelClassName="w-80 max-w-[calc(100vw-2rem)]"
    >
      <div className="flex items-end gap-2" aria-busy={busy}>
        <Select
          label={t("modeProvider")}
          value={mode.modeKey ?? ""}
          disabled={busy}
          className="min-w-0 flex-1"
          placeholder={t("modeProviderUnavailable")}
          options={mode.availableModes.map((provider) => ({ value: provider.key, label: provider.label }))}
          onChange={(key) => {
            void select(key).then((done) => {
              if (done) setOpen(false);
            });
          }}
        />
        {busy && <Spinner size="sm" />}
      </div>
    </Popover>
  );
}
