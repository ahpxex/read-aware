import { ArrowUp, ArrowCounterClockwise, PencilSimple, X } from "@phosphor-icons/react";
import { Body, Caption, IconButton } from "@read-aware/ui";
import type { PendingConversationTurn } from "../../../domain/conversation-turn-requests";
import { useTranslation } from "../../../i18n";

export function ChatTurnRequest({ request, onAccept, onDismiss }: {
  request: PendingConversationTurn | null; onAccept(id: string): void; onDismiss(id: string): void;
}) {
  const { t } = useTranslation("ai");
  if (!request) return null;
  const label = t(`chat.turnRequest.${request.action}`);
  return <section aria-label={label} className="shrink-0 border-t border-border px-3 py-2">
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Body className="text-sm">{label}</Body>
          <Caption className="break-all">{request.owner === "agent" ? t("chat.turnRequest.agent") : request.owner}</Caption>
        </div>
        <IconButton label={t("chat.turnRequest.dismiss")} size="sm" icon={<X size={16} />} onClick={() => onDismiss(request.id)} />
        <IconButton label={label} size="sm" icon={request.action === "draft" ? <PencilSimple size={16} />
          : request.action === "retry" ? <ArrowCounterClockwise size={16} /> : <ArrowUp size={16} />}
          onClick={() => onAccept(request.id)} />
      </div>
      {request.text && <Body className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{request.text}</Body>}
    </div>
  </section>;
}
