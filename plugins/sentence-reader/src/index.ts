import type { PluginModule } from "@read-aware/plugin-types";
import { segmentTextUnits } from "./segment";

const plugin: PluginModule = {
  activate(ctx) {
    const modes = ctx.reader.modes;
    if (!modes) throw new Error("Sentence Reader requires the reader:modes capability");

    modes.register({
      id: "guided-reading",
      kind: "text-unit-navigator",
      granularities: ["sentence", "paragraph"],
      segmentText: segmentTextUnits,
    });
  },
};

export default plugin;
