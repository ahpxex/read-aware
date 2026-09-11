import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { AgentThread } from "../runtime/thread";

/** In-process model fixture for host-port integration tests; no inference or desktop evidence. */
export function createScriptedThread(scope: ThreadScope, deps: RuntimeDeps, calls: { name: string; arguments: Record<string, unknown> }[]) {
  const provider = registerFauxProvider({ tokensPerSecond: 100_000 });
  provider.setResponses([
    ...calls.map(call => fauxAssistantMessage([fauxToolCall(call.name, call.arguments)], { stopReason: "toolUse" })),
    fauxAssistantMessage("Finished."),
  ]);
  const thread = new AgentThread({ scope, deps, resolveModel: () => provider.getModel(), getApiKey: () => "fixture", streamFn: streamSimple,
    completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}') });
  return { thread, dispose: () => { thread.dispose(); provider.unregister(); } };
}
