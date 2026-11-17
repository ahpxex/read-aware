import type { PluginModule } from "@read-aware/plugin-types";

const plugin: PluginModule = {
  activate(ctx) {
    if (ctx.manifest.description === "contribution-observation-reaction") {
      const registration = ctx.contributions.commands.register({ id: "reaction", title: "Reaction", run: () => {} });
      ctx.services.plugins.observeContributions({}, async (snapshot, delivery) => {
        if ("reaction" in snapshot) throw new Error("Contribution snapshot shape changed");
        const bound = ctx.withEvent(delivery, registration);
        await Promise.resolve();
        await bound.updateState({ revision: 1, visible: true, enabled: false });
        await bound.dispose();
        await ctx.services.storage.set("independent", true);
      });
      return;
    }
    if (ctx.manifest.description === "nullable-observation-reaction") {
      ctx.services.ui.reader!.image!.observe(async (snapshot, delivery) => {
        if (snapshot !== null) throw new Error("Closed snapshot changed");
        const bound = ctx.withEvent(delivery);
        await Promise.resolve();
        await bound.services.ui.reader!.setPanel!("chat", false);
      });
      return;
    }
    if (ctx.manifest.description === "memory-observation-reaction") {
      ctx.domains.memory!.events.observe({ kind: "inspect", memoryId: "m" }, async (snapshot, delivery) => {
        if (snapshot.status !== "ready" || "reaction" in snapshot) throw new Error("Memory snapshot shape changed");
        const bound = ctx.withEvent(delivery);
        await Promise.resolve();
        await bound.domains.memory!.commands!.mutate({
          op: "correct",
          memoryId: "m",
          expectedRevision: `mem1:${"a".repeat(64)}`,
          content: "changed",
        });
      });
      return;
    }
    if (ctx.manifest.description === "annotation-observation-reaction") {
      ctx.domains.annotations!.events.observe({ kind: "page", query: { bookId: "b" } }, async (snapshot, delivery) => {
        if (snapshot.status !== "ready" || "reaction" in snapshot) throw new Error("Annotation snapshot shape changed");
        const bound = ctx.withEvent(delivery);
        await Promise.resolve();
        await bound.domains.annotations!.commands!.applyChanges([
          { op: "updateNote", annotationId: "n", expectedRevision: `ann1:${"a".repeat(64)}`, body: "changed" },
        ]);
      });
      return;
    }
    if (ctx.manifest.description === "observation-reaction") {
      ctx.domains.settings.queries.observe({}, async (snapshot, delivery) => {
        if (snapshot.status !== "ready" || "reaction" in snapshot) throw new Error("Snapshot shape changed");
        const bound = ctx.withEvent(delivery);
        await Promise.resolve();
        await bound.services.storage.set("observed", snapshot.snapshot.revision);
      });
      return;
    }
    ctx.domains.library!.events.subscribe("book.starred", async (event) => {
      const bound = ctx.withEvent(event);
      if (bound.lifecycle !== ctx.lifecycle) throw new Error("Event binding changed activation identity");
      await Promise.resolve();
      await bound.domains.reading!.commands!.step("next");
      await bound.services.storage.set("reaction", true);
      await bound.services.storage.collection("reactions").get("one");
      // Independent actions continue to use the activation context.
      await ctx.services.storage.getDurable("independent");
    });
  },
};
export default plugin;
