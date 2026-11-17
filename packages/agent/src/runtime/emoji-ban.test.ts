import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createInMemoryDeps } from "../testing/fixtures";
import { AgentThread } from "./thread";

// Deltas of 4, 8 and 12 characters: at least one of them splits a surrogate pair.
for (const size of [1, 2, 3])
  test(`the emoji ban removes emoji and keeps the text symbols a book quotes (${size * 4}-character deltas)`, async () => {
    const faux = registerFauxProvider({ tokensPerSecond: 100_000, tokenSize: { min: size, max: size } });
    faux.setResponses([fauxAssistantMessage("版权页写着 © 2020 Acme™，箭头 ↔ 与对勾 ✔ 都是原文 😀🇨🇳 ✔️")]);
    const { deps } = createInMemoryDeps();
    const thread = new AgentThread({
      scope: { kind: "global", threadId: "emoji" },
      deps,
      resolveModel: () => faux.getModel() as Model<Api>,
      getApiKey: () => "fixture",
      streamFn: streamSimple,
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
    });
    try {
      let shown = "";
      for await (const chunk of thread.sendTurn({ text: "版权页写了什么？" }))
        if (chunk.type === "text") shown += chunk.text;
      expect(shown).toBe("版权页写着 © 2020 Acme™，箭头 ↔ 与对勾 ✔ 都是原文  ✔");
    } finally {
      thread.dispose();
      await thread.flushBackgroundWork();
      faux.unregister();
    }
  });
