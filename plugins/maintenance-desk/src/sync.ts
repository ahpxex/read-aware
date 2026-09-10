import type { PluginAction, PluginBlock, PluginContext, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { liveView } from "./live-view";
import { Operations, type Operation } from "./operations";
import { copy } from "./strings";
import { syncCopy } from "./sync-strings";

type Sync = NonNullable<PluginContext["services"]["sync"]>;
type Snapshot = Awaited<ReturnType<Sync["snapshot"]>>;
type Request = Parameters<Sync["requestFlow"]>[0];
const flowOperations = { connect: "syncConnect", disconnect: "syncDisconnect", "delete-account": "syncDelete",
  upgrade: "syncUpgrade", billing: "syncBilling" } as const satisfies Record<Request["action"], Operation>;

export function syncViews(ctx: PluginContext, signal: AbortSignal, operations: Operations, history: () => PluginView) {
  const t = syncCopy(ctx.locale), common = copy(ctx.locale);
  const service = () => {
    signal.throwIfAborted();
    if (!ctx.services.sync) throw { code: "ui/unavailable" };
    return ctx.services.sync;
  };
  const results: PluginAction = { id: "results", label: t.results, icon: "clock", run: () => ({ view: history() }) };
  const settings: PluginAction = { id: "settings", label: t.settings, icon: "arrow-square-out", run: async () => {
    await service().openSettings();
    return { close: true };
  } };
  const requestReview = (request: Request, label?: string): PluginView => {
    const operation = flowOperations[request.action];
    const review = { connect: t.connectReview, disconnect: t.disconnectReview, "delete-account": t.deleteReview,
      upgrade: t.upgradeReview, billing: t.billingReview }[request.action];
    return { kind: "detail", title: common[operation], content: [
      ...(label ? [{ kind: "keyValue" as const, rows: [{ label: t.backend, value: label }] }] : []),
      { kind: "text", text: review },
    ], actions: [{ id: "continue", label: t.continue, icon: "arrow-right", variant: request.action === "delete-account" ? "danger" : "solid",
      run: (): PluginViewResult => {
        const sync = service();
        if (!operations.start(operation, async waitSignal => {
          const receipt = await sync.requestFlow(request, { signal: waitSignal });
          return { status: receipt.status === "completed" ? "syncFlowCompleted" : receipt.status === "external-opened" ? "syncExternalOpened" : "cancelled" };
        })) return { toast: common.busy };
        return { close: true };
      },
    }] };
  };
  const connect = async (): Promise<PluginView> => {
    const options = await service().connectionOptions();
    signal.throwIfAborted();
    const choices = [{ label: t.relay, request: { action: "connect" } as Request }, ...options.map(option => ({
      label: option.label, request: { action: "connect", transportRef: option.ref } as Request,
    }))];
    const page = (offset: number): PluginView => ({ kind: "list", title: t.choose,
      items: choices.slice(offset, offset + 40).map((choice, index) => ({ id: `backend-${offset + index}`, title: choice.label,
        onSelect: () => ({ view: requestReview(choice.request, choice.label) }) })),
      pagination: { page: Math.floor(offset / 40) + 1, pageCount: Math.ceil(choices.length / 40),
        ...(offset > 0 ? { onPrevious: () => ({ view: page(offset - 40) }) } : {}),
        ...(offset + 40 < choices.length ? { onNext: () => ({ view: page(offset + 40) }) } : {}),
      }, actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await connect(), navigation: "replace" }) }],
    });
    return page(0);
  };
  const flowAction = (action: Request["action"]): PluginAction => ({ id: action, label: common[flowOperations[action]],
    icon: action === "delete-account" ? "trash" : "arrow-square-out",
    run: () => ({ view: requestReview({ action }) }),
  });
  const account = async (): Promise<PluginView> => {
    const value = await service().account();
    signal.throwIfAborted();
    const quota = (limit: number | null) => limit === null ? t.unlimited : String(limit);
    return { kind: "detail", title: t.account, content: value ? [{ kind: "keyValue", rows: [
      { label: t.tier, value: value.tier }, { label: t.bytesUsed, value: String(value.blobBytesUsed) },
      { label: t.eventsUsed, value: String(value.eventsUsed) }, { label: t.creditsUsed, value: String(value.aiCreditsUsed) },
      { label: t.maxBlob, value: quota(value.limits.maxBlobBytes) }, { label: t.maxBytes, value: quota(value.limits.maxAccountBlobBytes) },
      { label: t.maxEvents, value: quota(value.limits.maxAccountEvents) }, { label: t.maxCredits, value: quota(value.limits.aiMonthlyCredits) },
    ] }] : [{ kind: "text", text: t.noAccount }], actions: [
      { id: "refresh", label: t.account, icon: "arrows-clockwise", run: async () => ({ view: await account(), navigation: "replace" }) },
      ...(value ? [flowAction("upgrade"), ...(value.hasBilling ? [flowAction("billing")] : []), flowAction("delete-account")] : []), settings,
    ] };
  };
  const backlog = async (): Promise<PluginView> => {
    const value = await service().backlog();
    signal.throwIfAborted();
    return { kind: "detail", title: t.backlog, content: [{ kind: "keyValue", rows: [
      { label: t.events, value: String(value.events) }, { label: t.blobs, value: String(value.blobs) },
    ] }], actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await backlog(), navigation: "replace" }) }] };
  };
  const syncReview = (): PluginView => ({ kind: "detail", title: common.syncNow, content: [{ kind: "text", text: t.syncReview }],
    actions: [{ id: "continue", label: t.continue, icon: "arrows-clockwise", run: (): PluginViewResult => {
      const sync = service();
      if (!operations.start("syncNow", async () => {
        const receipt = await sync.requestSync();
        return { status: receipt.status === "completed" ? "syncCycleCompleted" : "syncAlreadyRunning" };
      })) return { toast: common.busy };
      return { view: history(), navigation: "reset" };
    } }],
  });
  const render = (snapshot: Snapshot): PluginView => {
    const content: PluginBlock[] = [
      ...(snapshot.lastErrorCode ? [{ kind: "error" as const, code: snapshot.lastErrorCode }] : []),
      { kind: "keyValue", rows: [
        { label: t.status, value: snapshot.supported ? t.states[snapshot.state] : t.unavailable },
        { label: t.backend, value: snapshot.backend ? t[snapshot.backend] : t.none },
        { label: t.lastSync, value: snapshot.lastSyncAt === null ? t.never : new Date(snapshot.lastSyncAt).toISOString() },
        { label: t.managing, value: snapshot.connectionBusy ? t.yes : t.no },
        { label: t.remaining, value: String(snapshot.backfillRemaining) },
      ] },
    ];
    if (snapshot.progress) content.push(
      { kind: "progress", value: null, label: t.phases[snapshot.progress.phase] },
      { kind: "keyValue", rows: (["pulled", "pushed", "verified", "backfilled", "blobsDone", "blobsTotal"] as const).map(key => ({ label: t[key], value: String(snapshot.progress![key]) })) },
    );
    if (snapshot.cycleStartBacklog) content.push({ kind: "heading", text: t.cycleBacklog }, { kind: "keyValue", rows: [
      { label: t.events, value: String(snapshot.cycleStartBacklog.events) }, { label: t.blobs, value: String(snapshot.cycleStartBacklog.blobs) },
    ] });
    if (snapshot.lastCycle) content.push({ kind: "heading", text: t.lastCycle }, { kind: "keyValue", rows:
      (["pulled", "pushed", "blobs", "backfilled"] as const).map(key => ({ label: t[key], value: String(snapshot.lastCycle![key]) })),
    });
    const ready = snapshot.supported && !snapshot.connectionBusy;
    return { kind: "detail", title: t.title, content, actions: [
      ...(ready && snapshot.connected && !["disabled", "unauthenticated", "syncing"].includes(snapshot.state)
        ? [{ id: "sync", label: common.syncNow, icon: "arrows-clockwise", run: () => ({ view: syncReview() }) }] : []),
      ...(ready && (!snapshot.connected || snapshot.state === "unauthenticated")
        ? [{ id: "connect", label: common.syncConnect, icon: "arrow-square-out", run: async () => ({ view: await connect() }) }] : []),
      ...(ready && snapshot.connected ? [flowAction("disconnect")] : []),
      ...(snapshot.supported ? [{ id: "backlog", label: t.backlog, icon: "database", run: async () => ({ view: await backlog() }) }] : []),
      ...(ready && snapshot.connected && snapshot.backend === "relay" && snapshot.state !== "unauthenticated"
        ? [{ id: "account", label: t.account, icon: "arrow-square-out", run: async () => ({ view: await account() }) }] : []),
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await open(), navigation: "replace" as const }) },
      settings, results,
    ] };
  };
  const open = async (): Promise<PluginView> => {
    const sync = service(), snapshot = await sync.snapshot();
    signal.throwIfAborted();
    return liveView(ctx, signal, snapshot, handler => sync.observe(handler), render);
  };
  return { open, title: t.title };
}
