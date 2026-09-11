import type { AnnotationObservation, PluginDisposable, PluginModule } from "@read-aware/plugin-types";

export default { activate(ctx) {
  const seed = JSON.parse(ctx.manifest.description!) as { bookId: string; noteId: string };
  const subscriptions: PluginDisposable[] = [], events: Record<string, AnnotationObservation[]> = { page: [], inspect: [] };
  for (const action of ["access", "start", "state", "stop", "invalid", "write"] as const) ctx.contributions.commands.register({ id: action, title: action, run: async () => {
    try {
      const domain = ctx.domains.annotations;
      let value: unknown;
      if (action === "access") value = { observe: !!domain?.events.observe, write: !!domain?.commands, commands: Object.keys(domain?.commands ?? {}).sort() };
      else if (action === "state") value = events;
      else if (action === "stop") { for (const sub of subscriptions.splice(0)) sub.dispose(); value = events; }
      else if (!domain) value = { unavailable: true };
      else if (action === "invalid") await domain.events.observe({ kind: "page", query: { limit: 101 } }, () => {});
      else if (action === "write") {
        const snapshot = (await domain.queries.inspect(seed.noteId))!;
        await domain.commands!.applyChanges([{ op: "updateNote", annotationId: seed.noteId, body: "Annotation observation: Worker changed", expectedRevision: snapshot.revision }]); value = true;
      }
      else if (!subscriptions.length) for (const kind of ["page", "inspect"] as const) {
        const query = kind === "page" ? { kind, query: { bookId: seed.bookId, limit: 20 } } : { kind, annotationId: seed.noteId };
        subscriptions.push(await domain.events.observe(query, event => { events[kind]!.push(event); if (events[kind]!.length > 32) events[kind]!.shift(); }));
      }
      return { toast: JSON.stringify({ status: "ok", value: value ?? true }) };
    } catch (error) { return { toast: JSON.stringify({ status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null }) }; }
  } });
} } satisfies PluginModule;
