import { Stop } from "@phosphor-icons/react";
import { IconButton, Progress, Tooltip } from "@read-aware/ui";
import type { PluginBlock } from "../lib/plugin-types";
import type { PluginResultRunner } from "./plugin-view-types";
import { usePluginProgressCancel } from "../hooks/usePluginProgressCancel";

type ProgressBlock = Extract<PluginBlock, { kind: "progress" }>;

function CancelButton({ action, onResult }: { action: NonNullable<ProgressBlock["cancel"]>; onResult: PluginResultRunner }) {
  const { pending, cancel } = usePluginProgressCancel(action, onResult);
  return <Tooltip content={action.label}><IconButton label={action.label} icon={<Stop size={16} />} size="sm"
    disabled={pending} onClick={() => void cancel()} /></Tooltip>;
}

export function PluginProgressBlock({ block, onResult }: { block: ProgressBlock; onResult: PluginResultRunner }) {
  return <div className="flex min-w-0 items-center gap-3">
    <Progress value={block.value} max={block.max} label={block.label} showValue={block.showValue} className="min-w-0 flex-1" />
    {block.cancel && <CancelButton key={block.cancel.id} action={block.cancel} onResult={onResult} />}
  </div>;
}
