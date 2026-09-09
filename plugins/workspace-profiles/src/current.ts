import type { PluginBlocksView, PluginContext, PluginView } from "@read-aware/plugin-types";
import { PROFILE_PATHS } from "./profiles";
import { copy, settingLabel } from "./strings";

export async function currentWorkspaceView(ctx: PluginContext): Promise<PluginView> {
  let snapshot = await ctx.domains.settings.queries.snapshot({ target: { kind: "global" } });
  let error: string | undefined, revision = 0;
  const content = (): PluginBlocksView => ({ kind: "blocks", blocks: [
    { kind: "heading", text: copy(ctx.locale).current },
    ...(error ? [{ kind: "error" as const, code: error }] : []),
    ...snapshot.settings.filter(setting => PROFILE_PATHS.some(path => path === setting.path)).map(setting => ({
      kind: "text" as const, text: `${settingLabel(ctx.locale, setting.path)}: ${String(setting.value)}`,
    })),
  ] });
  return { ...content(), live: { subscribe: channel => ctx.domains.settings.queries.observe({ target: { kind: "global" } }, async state => {
    if (state.status === "ready") { snapshot = state.snapshot; error = undefined; }
    else error = state.code;
    await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
  }) } };
}
