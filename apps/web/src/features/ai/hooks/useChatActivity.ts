import { useId, useState } from "react";
import { useTranslation } from "../../../i18n";
import type { ChatActivityPart } from "../lib/chat-activity";
import type { ChatToolPart } from "../lib/chat-types";
import { useChatToolLabel } from "./useChatToolLabel";

/**
 * The activity group stays open while the model is working in it (a tool is
 * running, reasoning streams, or the next round is pending) and folds once that
 * work hands over to the answer. A reader's own toggle wins for the rest of the
 * message; the settled message mounts fresh, so finished turns start folded.
 */
export function useChatActivity(part: ChatActivityPart, streaming: boolean, thinking: boolean, pendingStatus?: string) {
  const { t } = useTranslation("ai");
  const contentId = useId();
  const [override, setOverride] = useState<boolean | undefined>(undefined);
  const tools = part.parts.filter((step): step is ChatToolPart => step.type === "tool");
  const running = streaming ? tools.find((step) => step.state === "running") : undefined;
  const label = useChatToolLabel(running?.tool);
  const failed = tools.filter((step) => step.state === "error").length;
  const busy = Boolean(running) || thinking || Boolean(pendingStatus);
  const live = busy && !part.precedesProse;
  const expanded = override ?? live;
  const summary = [
    running ? label : thinking ? t("chat.thinking") : pendingStatus,
    t("chat.tools.calls", { count: tools.length }),
    failed ? t("chat.tools.failures", { count: failed }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return { contentId, expanded, live, busy, failed, summary, toggle: () => setOverride(!expanded) };
}
