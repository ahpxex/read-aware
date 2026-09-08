import type { AnnotationPageQuery, PluginContext, PluginViewResult } from "@read-aware/plugin-types";

type Writer<K extends "annotations" | "reading"> = NonNullable<PluginContext["domains"][K]> & {
  commands: NonNullable<NonNullable<PluginContext["domains"][K]>["commands"]>;
};
export type DeskContext = PluginContext & { domains: PluginContext["domains"] & {
  annotations: Writer<"annotations">;
  reading: Writer<"reading">;
  library: NonNullable<PluginContext["domains"]["library"]>;
} };
export type PageState = Omit<AnnotationPageQuery, "limit"> & { previous: (string | undefined)[] };
export type Refresh = () => Promise<PluginViewResult>;

export function assertCapabilities(ctx: PluginContext): asserts ctx is DeskContext {
  if (!ctx.domains.annotations?.commands || !ctx.domains.reading?.commands || !ctx.domains.library) {
    throw new Error("Annotation Desk requires annotations:write, reading:write and library:read");
  }
}
