import type { PluginModule } from "@read-aware/plugin-types";
import { sentenceReaderCopy, sentenceReaderUnits } from "./copy";
import { segmentTextUnits } from "./segment";

const plugin: PluginModule = {
  activate(ctx) {
    const modes = ctx.reader.modes;
    if (!modes) throw new Error("Sentence Reader requires the reader:modes capability");

    modes.register({
      id: "guided-reading",
      kind: "text-unit-navigator",
      icon: "rows",
      units: sentenceReaderUnits,
      defaultUnitId: "sentence",
      copy: sentenceReaderCopy,
      segmentText: segmentTextUnits,
    });
  },
};

export default plugin;
