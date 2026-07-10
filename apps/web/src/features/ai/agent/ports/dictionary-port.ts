/**
 * DictionaryPort：lookup_word 工具的 web 侧后端 —— useDictionaryLookup 的
 * 非 React 镜像。解释语言偏好 + 查词缓存 + BYOK account 全归这一层；
 * agent 的查词结果写回同一缓存，阅读器词典弹窗随后查同词直接命中。
 * 缺配置直接 throw（对话 hook 把消息呈现给用户），不 mock。
 */
import { lookUpWord, type DictionaryPort } from "@read-aware/agent";
import { DEFAULT_LOCALE, i18n, isAppLocale } from "../../../../i18n";
import { getCachedEntry, putCachedEntry } from "../../../reader/lib/dictionary-cache";
import {
  getDictionaryLanguage,
  resolveExplanationLanguageName,
} from "../../../reader/lib/dictionary-prefs";
import { getAIConfig } from "../../lib/ai-config";
import { accountFromConfig } from "../account";

export function createDictionaryPort(): DictionaryPort {
  return {
    lookUp: async ({ term, context, bookTitle }) => {
      const locale = i18n.language && isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
      const language = resolveExplanationLanguageName(getDictionaryLanguage(), locale);
      const cached = getCachedEntry(term, language, context);
      if (cached) return { entry: cached, language };
      const config = getAIConfig();
      if (!config?.apiKey) {
        throw new Error("AI is not configured — add an API key in Settings → AI.");
      }
      const { account, models } = accountFromConfig(config);
      const entry = await lookUpWord(account, models, {
        term,
        context,
        bookTitle,
        explanationLanguage: language,
      });
      putCachedEntry(term, language, context, entry);
      return { entry, language };
    },
  };
}
