import { BookOpenText, Lightbulb, Translate, TextAa, type Icon } from "@phosphor-icons/react";
import type { ReadingAiAction } from "@read-aware/core";

export const READING_AI_ICONS: Record<ReadingAiAction, Icon> = {
  explainSelection: Lightbulb, defineTerm: TextAa, translate: Translate, summarizeChapter: BookOpenText,
};
