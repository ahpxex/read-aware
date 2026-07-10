/**
 * 现场查词工具：包一层 DictionaryPort（web 侧实现复用阅读器词典的缓存、
 * 解释语言偏好与 LLM account）。工具内嵌一次模型调用（数秒量级），所以
 * UI 侧保持其活动行可见；完成后卡片经 details → reference chunk 跟进，
 * 无需再调 present_words。查词失败直接抛出 → pi 标 isError，无卡片。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { WordReference } from "../chunks";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import type { ReferenceToolDetails } from "./present-tools";

export function buildDictionaryTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const lookupWord: AgentTool = {
    name: "lookup_word",
    label: "Look up word",
    description:
      "Look up a word or short phrase in the AI dictionary and show the reader a word card with the full entry (pronunciation, senses, examples, etymology). Use it when the reader asks what a word means or when a precise definition genuinely helps; pass the surrounding sentence as context when you have it. The reader sees the full card; you receive only a one-line gist — the card IS the explanation, so after calling say nothing more about the definition, or add a single remark that ties the word to the passage or conversation. One lookup per word per reply: never call it again for a word whose card is already showing in this reply.",
    parameters: Type.Object({
      term: Type.String({
        description: "The word or short phrase to define, in its original language",
      }),
      context: Type.Optional(
        Type.String({
          description: "The sentence or passage it appears in — sharpens the contextual sense",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const { term, context } = params as { term: string; context?: string };
      const bookTitle =
        scope.kind === "book" ? (await deps.library.getBook(scope.bookId))?.title : undefined;
      const { entry, language } = await deps.dictionary.lookUp({ term, context, bookTitle });
      const word: WordReference = {
        term: entry.headword || term,
        language,
        entry,
        source: "lookup",
      };
      // 模型只拿一句要义 —— 完整词条只在卡片上。把全量 JSON 还给模型，
      // 它就会忍不住在正文里复述一遍（工具结果"用户看不见"的本能）。
      const gist = {
        presented: word.term,
        definition: entry.senses[0]?.definition,
        contextualMeaning: entry.contextualMeaning,
        note: "The reader is now looking at the full entry card (pronunciation, every sense with examples, etymology). Do not repeat any of it in prose.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(gist) }],
        details: { reference: { kind: "words", words: [word] } } satisfies ReferenceToolDetails,
      };
    },
  };

  return [lookupWord];
}
