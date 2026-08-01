import type { PluginViewResult } from "../lib/plugin-types";

export type PluginResultOptions = {
  presentation?: "push" | "dialog";
  dialogTitle?: string;
  /** Run without blocking the whole view, for reactive settings writes. */
  background?: boolean;
};

export type PluginResultRunner = (
  run: () => PluginViewResult | Promise<PluginViewResult>,
  options?: PluginResultOptions,
) => Promise<PluginViewResult>;
