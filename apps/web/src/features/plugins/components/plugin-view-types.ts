import type { PluginViewResult } from "../lib/plugin-types";

export type PluginResultOptions = {
  presentation?: "push" | "dialog";
  dialogTitle?: string;
};

export type PluginResultRunner = (
  run: () => PluginViewResult | Promise<PluginViewResult>,
  options?: PluginResultOptions,
) => Promise<PluginViewResult>;
