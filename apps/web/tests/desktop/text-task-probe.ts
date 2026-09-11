import type { BookTextTaskSnapshot, PluginDisposable, PluginModule } from "@read-aware/plugin-types";

let observation: PluginDisposable | undefined;
export default {
  async activate(ctx) {
    const { bookId, foreignTask, activationProbe } = JSON.parse(ctx.manifest.description!);
    let task: BookTextTaskSnapshot | undefined;
    const events: BookTextTaskSnapshot[] = [];
    if (activationProbe) await ctx.domains.library!.commands!.books.prepareText(bookId);
    const command = (id: string, run: () => unknown | Promise<unknown>) => ctx.contributions.commands.register({ id, title: id,
      run: async () => {
        try { return { toast: JSON.stringify(await run()) }; }
        catch (error) { return { toast: JSON.stringify({ errorCode: (error as { code?: string }).code ?? "unknown" }) }; }
      } });
    command("inspect", () => ({ library: !!ctx.domains.library, write: !!ctx.domains.library?.commands }));
    for (const rebuild of [false, true]) command(rebuild ? "rebuild" : "start", async () => {
      observation?.dispose(); events.length = 0;
      task = await ctx.domains.library!.commands!.books.prepareText(bookId, { rebuild });
      observation = ctx.domains.library!.events.observeTextTask(bookId, task.taskId, value => {
        events.push(value); if (events.length > 96) events.shift();
      });
      return task;
    });
    command("get", () => ctx.domains.library!.queries.books.getTextTask(bookId, task!.taskId));
    command("list", () => ctx.domains.library!.queries.books.listTextTasks(bookId));
    command("cancel", () => ctx.domains.library!.commands!.books.cancelTextTask(bookId, task!.taskId));
    command("events", () => events);
    command("unsubscribe", () => { observation?.dispose(); observation = undefined; return { count: events.length }; });
    command("foreign", () => ctx.domains.library!.queries.books.getTextTask(bookId, foreignTask));
  },
  deactivate() { observation?.dispose(); observation = undefined; },
} satisfies PluginModule;
