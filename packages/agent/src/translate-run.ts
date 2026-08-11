/**
 * 发布流水线的翻译器：英文源文案 → zh / ja。
 *
 *   bun run translate <file> [--to zh,ja] [--style changelog|docs] \
 *     [--provider deepseek] [--model deepseek-v4-flash]
 *   cat notes.md | bun run translate - --to zh
 *
 * 走 eval 同一条 headless 补全通道（key 来自 DEEPSEEK_API_KEY 或 pi CLI
 * auth）。术语表对齐 apps/web/src/i18n/locales 的产品词表，翻译只交给模型，
 * 核对仍是人的活——输出到 stdout，由发布流程的人（或 agent）粘回目标文件。
 */
import { readFileSync } from "node:fs";
import { resolveJudgeCompletion } from "./evals/model-config";

type TargetLocale = "zh" | "zh-hant" | "ja" | "fr" | "de" | "ru" | "es";

const TARGETS: readonly TargetLocale[] = ["zh", "zh-hant", "ja", "fr", "de", "ru", "es"];

const GLOSSARY: Record<TargetLocale, Record<string, string>> = {
  zh: {
    library: "书架",
    shelf: "书架",
    assistant: "智能助理",
    agent: "智能助理",
    "highlight (a reader annotation)": "划线",
    "ink highlight (the emphasized bar/label in charts)": "墨色高亮",
    note: "笔记",
    annotation: "标注",
    "read-aloud": "朗读",
    "sentence reader": "逐句阅读",
    "sentence-by-sentence": "逐句",
    "floating bar": "浮动条",
    "context": "上下文",
    dictionary: "词典",
    "command palette": "命令面板",
    "local-first": "本地优先",
    plugin: "插件",
    marketplace: "插件市场",
    changelog: "更新日志",
    "reading stats": "阅读统计",
    chapter: "章",
    "session timer": "本次阅读计时",
  },
  ja: {
    library: "ライブラリ",
    shelf: "ライブラリ",
    assistant: "アシスタント",
    agent: "アシスタント",
    "highlight (a reader annotation)": "ハイライト",
    "ink highlight (the emphasized bar/label in charts)": "インクのハイライト",
    note: "メモ",
    annotation: "注釈",
    "read-aloud": "読み上げ",
    "sentence reader": "文・段落ナビゲーター",
    "sentence-by-sentence": "一文ずつ",
    "floating bar": "フローティングバー",
    "context": "コンテキスト",
    dictionary: "辞書",
    "command palette": "コマンドパレット",
    "local-first": "ローカルファースト",
    plugin: "プラグイン",
    marketplace: "マーケットプレイス",
    changelog: "変更履歴",
    "reading stats": "読書統計",
    chapter: "章",
    "session timer": "セッションタイマー",
  },
  "zh-hant": {
    library: "書架",
    shelf: "書架",
    assistant: "智慧助理",
    agent: "智慧助理",
    "highlight (a reader annotation)": "劃線",
    "ink highlight (the emphasized bar/label in charts)": "墨色高亮",
    note: "筆記",
    annotation: "標註",
    "read-aloud": "朗讀",
    "sentence reader": "逐句閱讀",
    "sentence-by-sentence": "逐句",
    "floating bar": "浮動列",
    "context": "上下文",
    dictionary: "字典",
    "command palette": "命令面板",
    "local-first": "本地優先",
    plugin: "外掛",
    marketplace: "外掛市場",
    changelog: "更新日誌",
    "reading stats": "閱讀統計",
    chapter: "章",
    "session timer": "本次閱讀計時",
  },
  fr: {
    library: "bibliothèque",
    assistant: "assistant",
    "highlight (a reader annotation)": "surlignage",
    note: "note",
    "read-aloud": "lecture à voix haute",
    "sentence-by-sentence": "phrase par phrase",
    "local-first": "local d'abord (local-first)",
    plugin: "plugin",
    marketplace: "marketplace",
    changelog: "journal des modifications",
    "reading stats": "statistiques de lecture",
    "command palette": "palette de commandes",
  },
  de: {
    library: "Bibliothek",
    assistant: "Assistent",
    "highlight (a reader annotation)": "Markierung",
    note: "Notiz",
    "read-aloud": "Vorlesen",
    "sentence-by-sentence": "Satz für Satz",
    "local-first": "Local-First",
    plugin: "Plugin",
    marketplace: "Marktplatz",
    changelog: "Änderungsprotokoll",
    "reading stats": "Lesestatistik",
    "command palette": "Befehlspalette",
  },
  ru: {
    library: "библиотека",
    assistant: "ассистент",
    "highlight (a reader annotation)": "выделение",
    note: "заметка",
    "read-aloud": "чтение вслух",
    "sentence-by-sentence": "по предложениям",
    "local-first": "локальный подход (local-first)",
    plugin: "плагин",
    marketplace: "каталог плагинов",
    changelog: "журнал изменений",
    "reading stats": "статистика чтения",
    "command palette": "палитра команд",
  },
  es: {
    library: "biblioteca",
    assistant: "asistente",
    "highlight (a reader annotation)": "subrayado",
    note: "nota",
    "read-aloud": "lectura en voz alta",
    "sentence-by-sentence": "frase a frase",
    "local-first": "local primero (local-first)",
    plugin: "plugin",
    marketplace: "marketplace",
    changelog: "registro de cambios",
    "reading stats": "estadísticas de lectura",
    "command palette": "paleta de comandos",
  },
};

const LOCALE_NAME: Record<TargetLocale, string> = {
  zh: "Simplified Chinese (简体中文)",
  "zh-hant": "Traditional Chinese (繁體中文, Taiwan conventions)",
  ja: "Japanese (日本語)",
  fr: "French",
  de: "German",
  ru: "Russian",
  es: "Spanish",
};

const STYLE_RULES: Record<string, string> = {
  changelog: [
    "- This is a product changelog entry. Keep the register plain and human — written for the people using the app, not marketing.",
    "- Do NOT put a colon or any punctuation at the start of a body that follows a bolded title; the renderer inserts the separator.",
    "- Use full-width punctuation（，。：） for Chinese and Japanese prose.",
  ].join("\n"),
  docs: [
    "- This is product documentation. Keep it precise; prefer short sentences.",
    "- Use full-width punctuation for Chinese and Japanese prose.",
  ].join("\n"),
};

function buildPrompt(source: string, target: TargetLocale, style?: string): string {
  const glossary = Object.entries(GLOSSARY[target])
    .map(([en, translated]) => `  ${en} → ${translated}`)
    .join("\n");
  return [
    `Translate the following ReadAware (an AI-native reading app) text from English into ${LOCALE_NAME[target]}.`,
    "",
    "Rules:",
    "- Translate meaning, not word order; the result must read as if written natively.",
    "- Never translate: ReadAware, file-format names (EPUB, PDF, …), code, URLs, version numbers, JSON keys, markdown syntax, or anything inside backticks.",
    "- Keep the exact structure of the input: same markdown / JSON shape, same line breaks, same list nesting.",
    "- Product glossary (use these renderings consistently):",
    glossary,
    ...(style && STYLE_RULES[style] ? ["", STYLE_RULES[style]] : []),
    "",
    "Output ONLY the translation, no preamble and no commentary.",
    "",
    "Text to translate:",
    "<<<",
    source,
    ">>>",
  ].join("\n");
}

function parseArgs(argv: string[]) {
  const args = { file: "", to: [...TARGETS] as TargetLocale[], style: undefined as string | undefined, provider: "deepseek", model: "deepseek-v4-flash" };
  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift()!;
    if (arg === "--to") {
      const value = rest.shift() ?? "";
      args.to =
        value === "all"
          ? [...TARGETS]
          : value
              .split(",")
              .filter((entry): entry is TargetLocale =>
                (TARGETS as readonly string[]).includes(entry),
              );
    } else if (arg === "--style") args.style = rest.shift();
    else if (arg === "--provider") args.provider = rest.shift() ?? args.provider;
    else if (arg === "--model") args.model = rest.shift() ?? args.model;
    else if (!args.file) args.file = arg;
  }
  if (!args.file || args.to.length === 0) {
    console.error(
      `usage: bun run translate <file|-> [--to all|${TARGETS.join(",")}] [--style changelog|docs] [--provider p] [--model m]`,
    );
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const source =
  args.file === "-"
    ? readFileSync(0, "utf8")
    : readFileSync(args.file, "utf8");

const { complete, metadata } = resolveJudgeCompletion(args.provider, args.model);
console.error(`[translate] ${metadata.provider}:${metadata.model} → ${args.to.join(", ")}`);

// 各语言并行——翻译彼此独立，等最慢的那个即可。
/** 模型偶尔把输入定界符一起吐回来——剥掉，别让它进成品。 */
function stripDelimiters(text: string): string {
  return text
    .trim()
    .replace(/^<{3,}\s*\n?/, "")
    .replace(/\n?\s*>{3,}$/, "")
    .trim();
}

const results = await Promise.all(
  args.to.map(async (target) => {
    const started = Date.now();
    const text = await complete(buildPrompt(source, target, args.style));
    return { target, text: stripDelimiters(text), ms: Date.now() - started };
  }),
);

for (const { target, text, ms } of results) {
  console.error(`\n───── ${target} (${(ms / 1000).toFixed(1)}s) ─────`);
  console.log(`\n<!-- ${target} -->`);
  console.log(text);
}
