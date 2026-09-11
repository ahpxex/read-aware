import { expect, spyOn, test } from "bun:test";
import type { ThreadChunk } from "@read-aware/agent";
import { createInMemoryDeps } from "@read-aware/agent/testing";
import { createScriptedThread } from "@read-aware/agent/testing/scripted-thread";
import * as domain from "../../../../domain/entity-registry";
import { entityHost, entityRevision } from "../../../../../tests/helpers/entity-host";
import { buildRuntimeDeps } from "./index";
import { respondToUserInteraction } from "./user-interaction-port";
import { toChatInteractionRequest } from "../chat-interaction-request";

test.each(["approve", "decline", "abort"])("Agent entity %s flows through runtime ports and actual chat suspension", async answer => {
  const host = entityHost(), controller = new AbortController();
  const spies = [spyOn(domain, "queryEntities").mockImplementation(host.service.query), spyOn(domain, "decideEntity").mockImplementation(host.service.decide)];
  const { deps } = createInMemoryDeps();
  const runtime = buildRuntimeDeps(); deps.entityRegistry = runtime.entityRegistry; deps.interactions = runtime.interactions;
  const input = { op: "resolve", entityId: "one", kind: "person", canonicalName: "Alice", aliases: ["A"], expectedRevision: entityRevision };
  const { thread, dispose } = createScriptedThread({ kind: "global", threadId: `entity-${answer}` }, deps, [
    { name: "query_entities", arguments: { kind: "identities" } }, { name: "manage_entity", arguments: input },
  ]);
  const chunks: ThreadChunk[] = []; let interactionId: string | undefined;
  try {
    try {
      for await (const chunk of thread.sendTurn({ text: "Record Alice with alias A.", signal: controller.signal })) {
        chunks.push(chunk);
        if (chunk.type === "interaction" && chunk.phase === "request") {
          const chat = toChatInteractionRequest(chunk.request); interactionId = chat.id;
          expect(chat).toMatchObject({ kind: "permission", action: "manage-entity" });
          if (chat.kind !== "permission") throw Error("Expected permission");
          expect(JSON.parse(chat.subject).proposed).toEqual(input);
          expect(host.minted).toHaveLength(0);
          if (answer === "abort") controller.abort();
          else expect(respondToUserInteraction(chat.id, { optionId: answer })).toBe(true);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
    await thread.flushBackgroundWork();
    expect(interactionId).toBeString();
    expect(respondToUserInteraction(interactionId!, { optionId: "approve" })).toBe(false);
    expect(host.calls.filter(call => call.command === "entity_query")).toHaveLength(2);
    expect(host.calls.filter(call => call.command === "entity_commit")).toHaveLength(answer === "approve" ? 1 : 0);
    if (answer === "approve") {
      expect(host.calls.at(-1)).toMatchObject({ args: { event: { origin: "agent", payload: { canonicalName: "Alice", aliases: ["A"] } } } });
      expect(chunks).toContainEqual(expect.objectContaining({ type: "tool-step", tool: "manage_entity", phase: "end", isError: false }));
    }
  } finally { controller.abort(); dispose(); for (const spy of spies) spy.mockRestore(); }
});

test("entity approval translations name the decision and preserve its exact subject in all locales", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const json = await Bun.file(new URL(`../../../../i18n/locales/${locale}/ai.json`, import.meta.url)).json();
    const copy = json.chat.interaction.permission.manageEntity;
    expect(copy.question.length).toBeGreaterThan(0); expect(copy.approve.length).toBeGreaterThan(0);
    expect(copy.description).toContain("{{subject}}");
  }
});
