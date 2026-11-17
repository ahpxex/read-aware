import { Body, Button, Stack } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { PluginView } from "../lib/plugin-types";
import type { PluginResultRunner } from "./plugin-view-types";
import { usePluginFileDrop } from "../hooks/usePluginFileDrop";

/** This target alone receives a user grant; no window-wide plugin drop listener. */
export function PluginFileDrop({
  drop,
  busy,
  visible,
  onResult,
}: {
  drop: NonNullable<PluginView["fileDrop"]>;
  busy: boolean;
  visible: boolean;
  onResult: PluginResultRunner;
}) {
  const { t } = useTranslation("plugins");
  const { owner, onDragOver, onDrop, choose } = usePluginFileDrop(drop, busy, visible, onResult);
  if (!owner || !visible) return null;
  const label = t("fileDrop.label", { name: owner.name });
  return (
    <Stack
      gap="xs"
      data-plugin-file-drop="true"
      role="group"
      aria-label={label}
      className="rounded-surface border border-dashed border-border p-4"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Body>{label}</Body>
      <Body className="text-sm text-fg-muted">
        {t(drop.multiple ? "fileDrop.multiple" : "fileDrop.single")}
        {drop.extensions?.length ? ` (${drop.extensions.join(", ")})` : ""}
      </Body>
      <Button size="sm" variant="outline" disabled={busy} onClick={choose}>
        {t("fileDrop.choose")}
      </Button>
    </Stack>
  );
}
