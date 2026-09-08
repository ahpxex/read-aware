import { useState } from "react";
import { ListChecks } from "@phosphor-icons/react";
import type { ReadingModeSnapshot } from "@read-aware/core";
import { Popover, Select, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";

export function ReaderModePicker({ mode, select, busy }: {
  mode: ReadingModeSnapshot; select(key: string): Promise<boolean>; busy: boolean;
}) {
  const { t } = useTranslation("reader");
  const [open, setOpen] = useState(false);
  return (
    <Popover align="right" open={open} onOpenChange={setOpen}
      triggerLabel={t("modeProvider")} triggerTooltip={t("modeProvider")}
      trigger={<ListChecks size={18} aria-hidden="true" />}
      className="pointer-events-auto"
      triggerClassName="h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      panelClassName="w-80 max-w-[calc(100vw-2rem)]">
      <div className="flex items-end gap-2" aria-busy={busy}>
        <Select label={t("modeProvider")} value={mode.modeKey ?? ""} disabled={busy}
          className="min-w-0 flex-1" placeholder={t("modeProviderUnavailable")}
          options={mode.availableModes.map(provider => ({ value: provider.key, label: provider.label }))}
          onChange={key => { void select(key).then(done => { if (done) setOpen(false); }); }} />
        {busy && <Spinner size="sm" />}
      </div>
    </Popover>
  );
}
