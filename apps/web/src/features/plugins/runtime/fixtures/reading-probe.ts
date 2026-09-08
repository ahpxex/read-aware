import type { PluginModule } from "@read-aware/plugin-types";
import type { ReadingNavigationReceipt } from "@read-aware/core";

export default {
  activate(ctx) {
    const reading = ctx.domains.reading!;
    const seen: number[] = [];
    reading.events.observeSession(snapshot => { seen.push(snapshot.revision); });
    ctx.contributions.commands.register({
      id: "reading", title: "Reading wire probe",
      run: async () => {
        if (ctx.manifest.description === "read-only") {
          if (reading.commands) throw new Error("Read-only plugin received reading write commands");
          await ctx.services.storage.set("result", { commandsAvailable: false, snapshot: await reading.queries.session() });
          return { toast: "Read-only reading probe completed" };
        }
        const commands = reading.commands!;
        const bookId = ctx.services.storage.get<string>("bookId")!;
        const trace: Record<string, unknown> = {};
        const receipts: ReadingNavigationReceipt[] = [];
        receipts.push(await commands.openBook(bookId));
        receipts.push(await commands.goTo({ bookId, fraction: 0.45 }));
        receipts.push(await commands.goTo({ bookId, fraction: 0.8 }));
        receipts.push(await commands.back());
        receipts.push(await commands.forward());
        for (const [key, operation] of [
          ["missing", () => commands.goTo({ bookId, href: "missing.xhtml" })],
          ["stale", () => commands.goTo({ bookId, cfi: receipts[0]!.location.cfi, contentVersion: "old" })],
          ["invalid", () => commands.goTo({ bookId, fraction: 2 })],
        ] as const) {
          try { await operation(); throw new Error(`${key} unexpectedly succeeded`); }
          catch (error) {
            if (!error || typeof error !== "object" || !("code" in error)) throw error;
            trace[key] = error.code;
          }
        }
        receipts.push(await commands.step("next"));
        receipts.push(await commands.step("previous"));
        const snapshot = await reading.queries.session();
        await ctx.services.storage.set("result", { receipts, snapshot, trace, revisions: seen.slice(-30) });
        return { toast: "Reading probe completed" };
      },
    });
  },
} satisfies PluginModule;
