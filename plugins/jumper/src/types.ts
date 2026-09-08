import type { PluginContext } from "@read-aware/plugin-types";

export type JumperContext = PluginContext & { domains: PluginContext["domains"] & {
  library: NonNullable<PluginContext["domains"]["library"]>;
  reading: NonNullable<PluginContext["domains"]["reading"]> & {
    commands: NonNullable<NonNullable<PluginContext["domains"]["reading"]>["commands"]>;
  };
} };

export function assertCapabilities(ctx: PluginContext): asserts ctx is JumperContext {
  if (!ctx.domains.library || !ctx.domains.reading?.commands) throw new Error("Jumper requires library:read and reading:write");
}
