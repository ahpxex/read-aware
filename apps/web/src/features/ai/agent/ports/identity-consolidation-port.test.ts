import { expect, spyOn, test } from "bun:test";
import { createAgentRuntime } from "@read-aware/agent";
import { createInMemoryDeps } from "@read-aware/agent/testing";
import * as domain from "../../../../domain/identity-consolidation";
import * as entities from "../../../../domain/entity-registry";
import { identityHost } from "../../../../../tests/helpers/identity-host";
import { entityHost } from "../../../../../tests/helpers/entity-host";
import { buildRuntimeDeps } from "./index";

test("automatic runtime uses the production identity port through structured inference and host event minting", async () => {
  const host = identityHost(), registry = entityHost(); host.controls.receipt.emittedEventIds = ["event-1", "event-2"];
  host.controls.snapshot.sources[0]!.memory.updatedAt = new Date().toISOString();
  const spies = [spyOn(domain.identityConsolidationPort, "snapshot").mockImplementation(host.service.snapshot),
    spyOn(domain.identityConsolidationPort, "commit").mockImplementation(host.service.commit),
    spyOn(entities, "queryEntities").mockImplementation(registry.service.query)];
  const { deps } = createInMemoryDeps({ memories: [host.controls.snapshot.sources[0]!.memory] });
  const ports = buildRuntimeDeps(); deps.identityConsolidation = ports.identityConsolidation; deps.entityRegistry = ports.entityRegistry;
  let requests = 0;
  const runtime = createAgentRuntime({ deps, account: { kind: "api-key", provider: "custom-openai", apiKey: "fixture", baseUrl: "http://127.0.0.1/identity-fixture/v1", api: "openai-completions" },
    models: { smart: "fixture", fast: "fixture" }, fetch: async () => {
      requests++;
      const content = JSON.stringify({ summary: "Supported inference", complete: true, resolutions: [
        { entityId: null, kind: "person", canonicalName: "Alex", aliases: [], memoryIds: ["a"] },
      ], merges: [] });
      return new Response(`data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "Content-Type": "text/event-stream" } });
    } });
  try {
    expect(await runtime.consolidateIfNeeded()).toMatchObject({ identity: { status: "complete", emitted: 2 } });
    expect(requests).toBe(1);
    expect(host.calls.map(call => call.command)).toEqual(["identity_consolidation_snapshot", "identity_consolidation_commit"]);
    expect(host.calls[1]).toMatchObject({ args: { expectedRevision: host.controls.snapshot.revision,
      entityEvents: [{ origin: "agent", aggregateType: "entity", aggregateId: expect.stringMatching(/^auto-entity:/), type: "entity.resolved" }],
      profileEvent: { origin: "agent", type: "profile.updated", payload: { traits: { consolidated: { summary: "Supported inference",
        entityEvidence: [{ eventId: "event-1", memoryIds: ["a"] }] } } } } } });
    expect(host.broadcasts.map(draft => draft.type)).toEqual(["entity.resolved", "profile.updated"]);
  } finally { for (const spy of spies) spy.mockRestore(); }
});
