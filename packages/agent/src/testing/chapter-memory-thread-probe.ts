import type { Api, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { RuntimeDeps } from "../ports";
import { AgentThread, type SendTurnInput } from "../runtime/thread";

/** Native test harness: real supplied ports, scripted inference, no memory-building side effects. */
export function chapterMemoryThreadProbe(deps: RuntimeDeps, bookId: string) {
  const faux = registerFauxProvider({ tokensPerSecond: 100_000 }), model = faux.getModel() as Model<Api>;
  const samples: { narrative: boolean; concept: boolean; future: boolean; messages: number }[] = [];
  faux.setResponses(Array.from({ length: 16 }, () => context => {
    const prompt = context.systemPrompt ?? "";
    samples.push({ narrative: prompt.includes("Synthetic chapter 1: Ada"), concept: prompt.includes("Concept-only evidence"),
      future: prompt.includes("Synthetic chapter 3: Hidden"), messages: context.messages.length });
    return fauxAssistantMessage("Fixture response.");
  }));
  const thread = new AgentThread({ scope: { kind: "book", bookId },
    deps: { ...deps, memoryPolicy: { enabled: () => false, subscribe: () => () => {} } },
    resolveModel: () => model, getApiKey: () => "fixture", completeFn: async () => fauxAssistantMessage("{}"), streamFn: streamSimple });
  return {
    async send(input: Omit<SendTurnInput, "text">) {
      for await (const _ of thread.sendTurn({ text: "Continue the controlled fixture.", ...input })) { /* drain real thread */ }
      await thread.flushBackgroundWork();
      return { samples: structuredClone(samples) };
    },
    async dispose() { thread.dispose(); await thread.flushBackgroundWork(); faux.unregister(); },
  };
}
