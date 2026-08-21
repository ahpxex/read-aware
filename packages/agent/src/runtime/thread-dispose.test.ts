/**
 * dispose 的取消贯穿：线程销毁必须 abort 掉后台管道 in-flight 的
 * completeFn 调用——否则超时/关书后提炼请求孤儿化，挂满 provider
 * 连接池（GLM 全量实测：一个超时场景把后续套件饿了二十多分钟）。
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { Id } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { AgentThread } from "./thread";

const BOOK: ThreadScope = { kind: "book", bookId: "b1" as Id };

describe("thread dispose cancellation", () => {
  let faux: FauxProviderRegistration;

  afterEach(() => {
    faux?.unregister();
  });

  test("dispose aborts an in-flight background completeFn call", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    faux.setResponses([fauxAssistantMessage("回答。")]);

    // 挂起的后台调用：记录收到的 signal，等 abort 才返回——模拟一个
    // 慢 provider 上 in-flight 的提炼请求。
    let seenSignal: AbortSignal | undefined;
    let settled = false;
    const hangingComplete: CompleteFn = (_model, _context, options) =>
      new Promise((_resolve, reject) => {
        seenSignal = options?.signal;
        if (!options?.signal) {
          reject(new Error("background completeFn call carried no lifecycle signal"));
          return;
        }
        options.signal.addEventListener(
          "abort",
          () => {
            settled = true;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });

    const { deps } = createInMemoryDeps({
      books: [{ id: "b1" as Id, title: "书", status: "reading" }],
      chapters: { b1: [{ title: "一", text: "正文", hrefs: ["ch0.html"] }] },
    });
    const thread = new AgentThread({
      scope: BOOK,
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: hangingComplete,
      streamFn: streamSimple,
    });

    for await (const _ of thread.sendTurn({ text: "你好" })) {
      // drain
    }
    // 后台管道已启动并挂在第一个 completeFn 上
    await Bun.sleep(20);
    expect(seenSignal).toBeDefined();
    expect(seenSignal!.aborted).toBe(false);

    thread.dispose();
    expect(seenSignal!.aborted).toBe(true);
    await Bun.sleep(10);
    expect(settled).toBe(true);
  });
});
