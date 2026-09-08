import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({
      id: "test", title: "Callback lifetime probe",
      run: async () => {
        const registration = await ctx.contributions.commands.register({
          id: "temporary", title: "Temporary callback", run: () => ({ toast: "live" }),
        });
        const records = ctx.services.storage.collection("wire");
        const marker = {
          __fn: "h1", __disposable: "d1", nested: [{ __fn: "h2", ordinary: true }],
          callbacks: [{ ref: {}, handle: "h1" }],
        };
        await records.put("marker", marker);
        const stored = await records.get("marker");
        if (JSON.stringify(stored?.data) !== JSON.stringify(marker)) throw new Error("Callback markers changed business data");
        return {
          toast: "markers preserved",
          view: {
            kind: "detail", title: "Callback probe", content: [{ kind: "markdown", markdown: "Temporary registration" }],
            actions: [{
              id: "release", label: "Release",
              run: async () => {
                registration.dispose(); registration.dispose();
                // Disposal is a void API; this next RPC is an ordered Worker barrier.
                await Promise.resolve();
                await records.get("marker");
                return { toast: "released" };
              },
            }],
          },
        };
      },
    });
  },
} satisfies PluginModule;
