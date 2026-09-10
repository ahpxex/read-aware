import type { PluginContext, PluginConversationsDomain, PluginDetailView, PluginListView } from "@read-aware/plugin-types";
import type { ConversationTarget } from "./conversation-controls";
import { conversationWords } from "./conversation-control-strings";

type Request = Awaited<ReturnType<PluginConversationsDomain["queries"]["turnRequests"]>>[number];

function requestDetail(ctx: PluginContext, request: Request): PluginDetailView {
  const t = conversationWords(ctx.locale);
  return { kind: "detail", title: t[request.action], content: [{ kind: "keyValue", rows: [
    { label: t.target, value: `${request.target.kind}:${request.target.id}` },
    { label: t.state, value: t[request.status] },
  ] }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => {
      const current = (await ctx.domains.conversations!.queries.turnRequests()).find(r => r.id === request.id);
      if (!current) throw Object.assign(Error("Retained request missing"), { code: "ui/invalid-target" });
      return { view: requestDetail(ctx, current), navigation: "replace" };
    } },
    ...(request.status === "pending" && ctx.domains.conversations!.commands ? [{ id: "cancel", label: t.cancel, icon: "x", run: async () => {
      const receipt = await ctx.domains.conversations!.commands!.cancelTurnRequest(request.id);
      return { view: requestDetail(ctx, receipt), navigation: "replace" as const };
    } }] : []),
  ] };
}

export async function turnRequestsView(ctx: PluginContext, target?: ConversationTarget, page = 0): Promise<PluginListView> {
  const t = conversationWords(ctx.locale);
  const requests = (await ctx.domains.conversations!.queries.turnRequests())
    .filter(r => !target || r.target.kind === target.kind && r.target.id === target.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const current = Math.min(Math.max(0, page), Math.max(0, Math.ceil(requests.length / 40) - 1));
  return { kind: "list", title: t.requests, emptyText: t.noRequests,
    items: requests.slice(current * 40, (current + 1) * 40).map(r => ({ id: r.id, title: t[r.action], subtitle: `${t[r.status]} / ${r.target.kind}:${r.target.id}`, icon: "chat-circle",
      onSelect: () => ({ view: requestDetail(ctx, r) }) })), actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await turnRequestsView(ctx, target, current), navigation: "replace" }) },
    ], pagination: { page: current + 1,
      ...(current > 0 ? { onPrevious: async () => ({ view: await turnRequestsView(ctx, target, current - 1), navigation: "replace" as const }) } : {}),
      ...((current + 1) * 40 < requests.length ? { onNext: async () => ({ view: await turnRequestsView(ctx, target, current + 1), navigation: "replace" as const }) } : {}),
    },
  };
}
