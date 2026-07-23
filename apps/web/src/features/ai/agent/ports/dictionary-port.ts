/**
 * DictionaryPort：lookup_word 工具的 web 侧后端 —— useDictionaryLookup 的
 * 非 React 镜像。解释语言偏好 + 查词缓存 + BYOK account 全归这一层；
 * agent 的查词结果写回同一缓存，阅读器词典弹窗随后查同词直接命中。
 * 缺配置直接 throw（对话 hook 把消息呈现给用户），不 mock。
 */
import { lookUpWord, type DictionaryPort } from "@read-aware/agent";
import { DEFAULT_LOCALE, i18n, isAppLocale } from "../../../../i18n";
import { getCachedLookup, putCachedLookup } from "../../../reader/lib/dictionary-cache";
import {
  getDictionaryLanguage,
  resolveExplanationLanguageName,
} from "../../../reader/lib/dictionary-prefs";
import { getAIConfig } from "../../lib/ai-config";
import { AiNotConfiguredError } from "../../lib/ai-errors";
import { accountFromConfig } from "../account";

export function createDictionaryPort(): DictionaryPort {
  return {
    lookUp: async ({ term, context, bookTitle, explanationLanguage }) => {
      const locale = i18n.language && isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
      const language =
        explanationLanguage?.trim() ||
        resolveExplanationLanguageName(getDictionaryLanguage(), locale);
      // The tool always wants a term entry — a sentence-mode record under the
      // same key (same text looked up from the reader) doesn't satisfy it.
      const cached = getCachedLookup(term, language, context);
      if (cached?.kind === "term") return { entry: cached.entry, language };
      const config = getAIConfig();
      if (!config?.apiKey) {
        throw new AiNotConfiguredError();
      }
      const { account, models } = accountFromConfig(config);
      const entry = await lookUpWord(account, models, {
        term,
        context,
        bookTitle,
        explanationLanguage: language,
      });
      putCachedLookup(term, language, context, { kind: "term", entry });
      return { entry, language };
    },
  };
}
