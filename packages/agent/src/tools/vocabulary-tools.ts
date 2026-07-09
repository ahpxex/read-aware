/**
 * 词汇表工具（doc §6 检索工具的一员）：让 agent 按需读到用户从词典保存的生词。
 * 跨书全局数据 —— 书线程与全局线程都挂。端口之上的本地函数,不走网络。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

export function buildVocabularyTools(deps: RuntimeDeps): AgentTool[] {
  const getVocabulary: AgentTool = {
    name: "get_vocabulary",
    label: "Vocabulary",
    description:
      "List the words the reader saved to their vocabulary from the dictionary, each with a short definition and the book it came from. Call it WITHOUT query to see the whole list — only pass query to filter for one specific word.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description:
            "Text filter over saved words and their definitions. Omit to list all (recommended default).",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const { query } = params as { query?: string };
      return textResult(await deps.vocabulary.listVocabulary({ query }));
    },
  };

  return [getVocabulary];
}
