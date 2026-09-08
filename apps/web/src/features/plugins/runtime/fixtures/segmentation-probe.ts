import type { PluginModule } from "@read-aware/plugin-types";
import { sentenceReaderCopy, sentenceReaderUnits } from "../../../../../../../plugins/sentence-reader/src/copy";
import { segmentTextUnits } from "../../../../../../../plugins/sentence-reader/src/segment";

export default {
  activate(ctx) {
    if (!ctx.contributions.readerModes) throw new Error("Probe requires reader:modes");
    let behavior: "slow" | "reject" = "slow";
    for (const value of ["slow", "reject"] as const) ctx.contributions.commands.register({
      id: value, title: value, run() { behavior = value; },
    });
    ctx.contributions.readerModes.register({
      id: "reader", kind: "text-unit-navigator", units: sentenceReaderUnits,
      defaultUnitId: "sentence", copy: sentenceReaderCopy,
      async segmentText(input) {
        const chosen = behavior;
        await new Promise(resolve => setTimeout(resolve, 500));
        if (chosen === "reject") throw new Error("Intentional segmentation failure");
        return segmentTextUnits(input);
      },
    });
  },
} satisfies PluginModule;
