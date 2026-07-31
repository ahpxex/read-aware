import type { PluginModule } from "@read-aware/plugin-types";

/**
 * Editorial Themes is fully declarative: the themes and the bundled EB
 * Garamond faces live in manifest.json (`themes` / `fonts`, gated by the
 * `ui:themes` permission), and the host registers them while the plugin is
 * enabled. There is nothing to run.
 */
const plugin: PluginModule = {
  activate() {},
};

export default plugin;
