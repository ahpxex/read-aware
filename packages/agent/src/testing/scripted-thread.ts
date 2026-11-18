import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { Context, JsonObject } from "@earendil-works/pi-ai";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { AgentThread } from "../runtime/thread";

/**
 * One request the scripted model receives: what the runtime actually put in
 * front of a model. Named here so a host's tests can keep what `observe`
 * hands them without depending on the model library themselves.
 */
export type ScriptedRequest = Context;

/** In-process model fixture for host-port integration tests; no inference or desktop evidence. */
export function createScriptedThread(
  scope: ThreadScope,
  deps: RuntimeDeps,
  calls: { name: string; arguments: JsonObject }[],
  /** Sees every request the scripted model receives. */
  observe?: (request: ScriptedRequest) => void,
) {
  const provider = registerFauxProvider({ tokensPerSecond: 100_000 });
  const responses = [
    ...calls.flatMap((call) => [
      fauxAssistantMessage([fauxToolCall("get_host_capabilities", { catalog: "tools", query: call.name })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxToolCall(call.name, call.arguments)], { stopReason: "toolUse" }),
    ]),
    fauxAssistantMessage("Finished."),
  ];
  provider.setResponses(
    responses.map((response) => (context: Context) => {
      observe?.(context);
      return response;
    }),
  );
  const thread = new AgentThread({
    scope,
    deps,
    resolveModel: () => provider.getModel(),
    getApiKey: () => "fixture",
    streamFn: streamSimple,
    completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
  });
  return {
    thread,
    dispose: () => {
      thread.dispose();
      provider.unregister();
    },
  };
}
