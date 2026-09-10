import type { PluginModule } from "@read-aware/plugin-types";
import { copy } from "./strings";
import { maintenanceDesk } from "./views";

let desk: ReturnType<typeof maintenanceDesk> | undefined;
export default {
  activate(ctx) {
    if (!ctx.domains.settings?.commands.refreshModelCatalog || !ctx.services.diagnostics) {
      throw Error("Maintenance Desk requires catalog discovery, network and diagnostics access");
    }
    desk?.dispose();
    const current = maintenanceDesk(ctx);
    desk = current;
    const title = copy(ctx.locale).title;
    ctx.contributions.commands.register({ id: "open", title, icon: "database", run: () => ({ view: current.home() }) });
    ctx.contributions.headerActions.register({ id: "shelf", title, icon: "database", surface: "shelf", presentation: "popup", view: current.home });
  },
  deactivate() { desk?.dispose(); desk = undefined; },
} satisfies PluginModule;
