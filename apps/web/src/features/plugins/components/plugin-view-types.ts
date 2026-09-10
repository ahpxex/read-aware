import type { PluginViewResult } from "../lib/plugin-types";

export type PluginResultOptions = {
  presentation?: "push" | "dialog";
  dialogTitle?: string;
  /** Run without blocking the whole view, for reactive settings writes. */
  background?: boolean;
  /** Host default for data controls; explicit plugin navigation still wins. */
  navigation?: "replace";
};

export type PluginResultRunner = (
  run: () => PluginViewResult | Promise<PluginViewResult>,
  options?: PluginResultOptions,
) => Promise<PluginViewResult>;
