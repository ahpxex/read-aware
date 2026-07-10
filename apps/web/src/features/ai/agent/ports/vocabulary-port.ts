/**
 * VocabularyPort：把阅读器的本地词汇表（reader/lib/vocabulary）适配成 agent
 * 用的精简视图。只读 —— 保存由词典 UI 负责。最近优先，query 做文本过滤。
 */
import type { VocabularyEntry, VocabularyPort } from "@read-aware/agent";
import { getVocabulary, type VocabularyItem } from "../../../reader/lib/vocabulary";

function toEntry(item: VocabularyItem): VocabularyEntry {
  const first = item.entry.senses[0];
  const definition = first
    ? first.partOfSpeech
      ? `(${first.partOfSpeech}) ${first.definition}`
      : first.definition
    : (item.entry.contextualMeaning ?? "");
  return {
    term: item.term,
    language: item.language,
    definition,
    bookTitle: item.bookTitle,
    addedAt: new Date(item.addedAt).toISOString(),
    // 完整词条只进 present_words 的卡片 payload；工具层负责在给模型的
    // 列表里剥掉它（vocabulary-tools）。
    entry: item.entry,
  };
}

export function createVocabularyPort(): VocabularyPort {
  return {
    listVocabulary: async ({ query, limit } = {}) => {
      const needle = query?.trim().toLowerCase();
      const entries = [...getVocabulary()]
        .sort((a, b) => b.addedAt - a.addedAt)
        .map(toEntry)
        .filter(
          (entry) =>
            !needle ||
            entry.term.toLowerCase().includes(needle) ||
            entry.definition.toLowerCase().includes(needle),
        );
      return typeof limit === "number" ? entries.slice(0, limit) : entries;
    },
  };
}
