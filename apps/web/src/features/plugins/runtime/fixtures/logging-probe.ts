import type { PluginContext, PluginMigrationContext } from "@read-aware/plugin-types";

export default {
  async activate(ctx: PluginContext) {
    await ctx.services.logging.write({ level: "info", event: "activation.started", fields: { attempt: 1 } });
  },
  async migrate(ctx: PluginMigrationContext) {
    await ctx.logging.write({ level: "warn", event: "migration.failed", errorCode: "db/locked" });
  },
};
