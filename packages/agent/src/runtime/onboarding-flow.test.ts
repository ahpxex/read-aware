/** Onboarding runtime 侧：快选落库 + 全局线程首次使用的访谈模式。 */
import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { CompleteFn } from "../models/complete";
import { applyOnboarding } from "../onboarding";
import { createInMemoryDeps } from "../testing/fixtures";
import { AgentThread } from "./thread";

const noop: CompleteFn = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');

describe("onboarding", () => {
  let faux: FauxProviderRegistration;

  afterEach(() => {
    faux?.unregister();
  });

  test("applyOnboarding writes the profile summary and seeds user memories", async () => {
    const { deps, stores } = createInMemoryDeps();
    await applyOnboarding(deps, {
      goals: "系统理解货币史",
      background: "工程背景",
      explanationDepth: "第一性原理，别怕长",
    });

    expect(stores.profile.summary).toContain("工程背景");
    expect(stores.profile.summary).toContain("货币史");
    const seeds = stores.savedMemoryInputs.filter((input) => input.origin === "onboarding");
    expect(seeds).toHaveLength(3);
    expect(seeds.every((seed) => seed.scope === "user")).toBe(true);
  });

  test("global thread enters interview mode only when the profile is empty and history is fresh", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    const contexts: Context[] = [];
    faux.setResponses([
      (context) => {
        contexts.push(context);
        return fauxAssistantMessage("你好！先聊聊你想读什么？");
      },
      (context) => {
        contexts.push(context);
        return fauxAssistantMessage("明白了。");
      },
    ]);
    const { deps } = createInMemoryDeps(); // 无画像
    const thread = new AgentThread({
      scope: { kind: "global" },
      deps,
      resolveModel: () => model,
      getApiKey: () => "k",
      completeFn: noop,
    });

    for await (const _ of thread.sendTurn({ text: "你好" })) {
      // drain
    }
    expect(contexts[0]?.systemPrompt).toContain("first session");

    // 第二轮：已有历史 → 不再进入访谈模式
    for await (const _ of thread.sendTurn({ text: "我想读经济史" })) {
      // drain
    }
    expect(contexts[1]?.systemPrompt).not.toContain("first session");
  });

  test("a filled profile suppresses interview mode from the start", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    let captured: Context | undefined;
    faux.setResponses([
      (context) => {
        captured = context;
        return fauxAssistantMessage("好的");
      },
    ]);
    const { deps } = createInMemoryDeps({ profile: "工程背景，偏好深挖" });
    const thread = new AgentThread({
      scope: { kind: "global" },
      deps,
      resolveModel: () => model,
      getApiKey: () => "k",
      completeFn: noop,
    });

    for await (const _ of thread.sendTurn({ text: "你好" })) {
      // drain
    }
    expect(captured?.systemPrompt).not.toContain("first session");
    expect(captured?.systemPrompt).toContain("工程背景");
  });
});
