import type { PluginContext, PluginConversationsDomain, PluginDetailView, PluginFormView, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { conversationWords } from "./conversation-control-strings";
import { turnRequestsView } from "./turn-requests";

type Commands = NonNullable<PluginConversationsDomain["commands"]>;
export type ConversationTarget = Parameters<Commands["stop"]>[0];
type Runtime = Awaited<ReturnType<PluginConversationsDomain["queries"]["runtime"]>>;

export function controlReceipt(ctx: PluginContext, target: ConversationTarget, title: string, status: string): PluginDetailView {
  const t = conversationWords(ctx.locale);
  return { kind: "detail", title, content: [{ kind: "text", text: status }, { kind: "keyValue", rows: [{ label: t.target, value: `${target.kind}:${target.id}` }] }],
    actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise",
      run: async () => ({ view: await conversationControls(ctx, target, title), navigation: "replace" }) }] };
}

function proposal(ctx: PluginContext, target: ConversationTarget, action: "draft" | "send" | "retry"): PluginFormView {
  const t = conversationWords(ctx.locale);
  return { kind: "form", title: t[action], submitLabel: t[action], fields: action === "retry"
    ? [{ id: "confirm", kind: "checkbox", label: t.confirmRetry, value: false }]
    : [{ id: "text", kind: "textarea", label: t.text, value: "" }],
    onSubmit: async (values): Promise<PluginViewResult> => {
      if (action === "retry" && values.confirm !== true) return { fieldErrors: { confirm: t.confirm } };
      if (action !== "retry" && (typeof values.text !== "string" || !values.text.trim() || values.text.length > 65536)) return { fieldErrors: { text: t.invalidText } };
      const receipt = await ctx.domains.conversations!.commands!.requestTurn(action === "retry" ? { target, action } : { target, action, text: values.text as string });
      // The host owns adoption/send approval. Expose that surface, not a fake completion screen.
      return { close: true, toast: t[receipt.status] };
    },
  };
}

export async function conversationControls(ctx: PluginContext, input: ConversationTarget, title: string): Promise<PluginView> {
  const target = { ...input }, t = conversationWords(ctx.locale), domain = ctx.domains.conversations!;
  const render = (runtime: Runtime): PluginDetailView => {
    const session = runtime.sessions.find(s => s.kind === target.kind && s.id === target.id);
    const ready = session && !session.loading && !session.streaming;
    return { kind: "detail", title: `${title} / ${t.controls}`, content: [{ kind: "keyValue", rows: [
      { label: t.target, value: `${target.kind}:${target.id}` },
      { label: t.state, value: !session ? t.inactive : session.loading ? t.loading : session.streaming ? t.streaming : t.idle },
      ...(session ? [{ label: t.messages, value: String(session.messageCount) }] : []),
    ] }], actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await conversationControls(ctx, target, title), navigation: "replace" }) },
      { id: "requests", label: t.requests, icon: "list", run: async () => ({ view: await turnRequestsView(ctx, target) }) },
      ...(domain.commands ? [
        ...(target.kind === "global" ? [{ id: "select", label: t.select, icon: "chat-circle", run: async () => {
          const receipt = await domain.commands!.selectThread(target.id);
          return { view: controlReceipt(ctx, receipt.target, title, t.selected), navigation: "replace" as const };
        } }] : []),
        ...(ready ? (["draft", "send", ...(session.messageCount > 0 ? ["retry" as const] : [])] as const).map(action => ({
          id: action, label: t[action], icon: action === "retry" ? "arrow-clockwise" : "paper-plane-tilt",
          run: () => ({ view: proposal(ctx, target, action) }),
        })) : []),
        { id: "stop", label: t.stop, icon: "stop", run: async () => {
          const receipt = await domain.commands!.stop(target);
          return { view: controlReceipt(ctx, receipt.target, title, t.stopped), navigation: "replace" as const };
        } },
        { id: "clear", label: t.clear, icon: "trash", run: () => ({ view: {
          kind: "form", title: `${title} / ${t.clear}`, submitLabel: t.clear, fields: [
            { id: "confirm", kind: "checkbox", label: t.confirmClear, description: `${target.kind}:${target.id}`, value: false },
          ], onSubmit: async values => {
            if (values.confirm !== true) return { fieldErrors: { confirm: t.confirm } };
            const receipt = await domain.commands!.clear(target);
            return { view: controlReceipt(ctx, receipt.target, title, t.cleared), navigation: "replace" };
          },
        } satisfies PluginFormView }) },
      ] : []),
    ] };
  };
  const initial = await domain.queries.runtime();
  return { ...render(initial), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = domain.events.observeRuntime(async state => {
      if (!disposed) await ctx.services.ui.publishView(channel, { revision: ++revision, view: render(state) });
    });
    return { dispose() { disposed = true; subscription.dispose(); } };
  } } };
}
