/**
 * 词典查词（Reader 选中 / 导航条 → Look up）：用 fast 档发一次结构化补全。
 * 词 / 短语走 `lookUpWord`，返回详尽词条 —— 音标、分义项释义与例句、词源、
 * 语境含义；整句 / 整段走 `explainSentence`，返回整句翻译 + 值得解释的词的
 * 逐个注解。`isSentenceLookup` 是两者之间的分流启发式。与 chat 共用同一套
 * pi-ai provider 栈，绝不另起 HTTP 客户端（同 test-connection 的约定）。
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createModelResolver, type LlmAccount, type RoleModels } from "./accounts";
import { createCompleteFn } from "./complete";
import { buildProviderRegistry } from "./registry";

export interface DictionarySense {
  /** 词性，用解释语言表述（如 “名词” / “noun”）。 */
  partOfSpeech: string;
  /** 详细释义 —— 不是一词对译，而是完整的说明。 */
  definition: string;
  /** 该义项的例句（0–2 条）。 */
  examples: string[];
}

export interface DictionaryEntry {
  /** 词头（保持原语言）。 */
  headword: string;
  /** 音标 / 读音（IPA，模型不确定时可缺省）。 */
  pronunciation?: string;
  senses: DictionarySense[];
  /** 词源 / 构词（未知时缺省）。 */
  etymology?: string;
  /** 该词在传入语境里的具体含义（无语境时缺省）。 */
  contextualMeaning?: string;
}

export interface LookUpInput {
  /** 要查的词或短语。 */
  term: string;
  /** 词所在的句子 / 段落（可选，用来给出语境释义）。 */
  context?: string;
  /** 书名（可选，进一步限定语境）。 */
  bookTitle?: string;
  /** 用哪种语言来解释（人类可读的语言名，如 "Simplified Chinese"）。 */
  explanationLanguage: string;
}

/** 句子模式里单个值得解释的词 / 表达。 */
export interface SentenceGloss {
  /** 词 / 表达，按它在原句里的样子（保持原语言）。 */
  term: string;
  /** 音标（IPA，模型不确定时缺省）。 */
  pronunciation?: string;
  /** 它在这句话里的含义，用解释语言表述。 */
  meaning: string;
}

/** 整句 / 整段的解释：翻译 + 逐词注解。 */
export interface SentenceExplanation {
  /** 整句在解释语言下的忠实、自然的翻译。 */
  translation: string;
  /** 按出现顺序排列的注解（基础词汇之外的词）。 */
  glosses: SentenceGloss[];
  /** 语法 / 习语 / 语气上值得一提的一句话（没有时缺省）。 */
  note?: string;
}

export interface ExplainSentenceInput {
  /** 要解释的句子 / 段落。 */
  sentence: string;
  /** 书名（可选，限定语境）。 */
  bookTitle?: string;
  /** 用哪种语言来解释。 */
  explanationLanguage: string;
}

/** 一次查询的两种可能形态 —— 由 `isSentenceLookup` 分流。 */
export type DictionaryLookupResult =
  | { kind: "term"; entry: DictionaryEntry }
  | { kind: "sentence"; explanation: SentenceExplanation };

const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g;

/**
 * 词条还是句子？词典 prompt 只建模词 / 短语，整句喂进去行为不可控，所以查询
 * 前先分流。启发式（宁可保守，短语误判成句子的代价低于反过来）：
 * 空格分词 ≥ 6 个、CJK 字符 ≥ 10 个（中日文短语不靠空格分词），或 ≥ 4 词且
 * 内部带句读 —— 任一命中即按句子处理。
 */
export function isSentenceLookup(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ");
  const words = normalized.split(" ").filter(Boolean).length;
  if (words >= 6) return true;
  const cjkCount = (normalized.match(CJK_CHAR) ?? []).length;
  if (cjkCount >= 10) return true;
  return words >= 4 && /[.!?。！？;；…，,][\s"'”’)»\]]*\S/u.test(normalized);
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** 从模型输出里抠出 JSON 对象（容忍 ```json 围栏与前后废话）。 */
function extractJsonObject(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("dictionary response contained no JSON object");
  }
  return text.slice(start, end + 1);
}

function parseEntry(raw: string): DictionaryEntry {
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<DictionaryEntry>;

  const senses: DictionarySense[] = Array.isArray(parsed.senses)
    ? parsed.senses
        .filter(
          (sense): sense is DictionarySense =>
            !!sense && typeof (sense as DictionarySense).definition === "string",
        )
        .map((sense) => ({
          partOfSpeech: typeof sense.partOfSpeech === "string" ? sense.partOfSpeech : "",
          definition: sense.definition,
          examples: Array.isArray(sense.examples)
            ? sense.examples.filter((example): example is string => typeof example === "string")
            : [],
        }))
    : [];

  return {
    headword:
      typeof parsed.headword === "string" && parsed.headword.trim() ? parsed.headword.trim() : "",
    pronunciation: typeof parsed.pronunciation === "string" ? parsed.pronunciation : undefined,
    senses,
    etymology: typeof parsed.etymology === "string" ? parsed.etymology : undefined,
    contextualMeaning:
      typeof parsed.contextualMeaning === "string" ? parsed.contextualMeaning : undefined,
  };
}

const SYSTEM_PROMPT = [
  "You are a meticulous lexicographer embedded in a reading app.",
  "Given a term (a word or short phrase) and, optionally, the sentence it appears in,",
  "produce a rich, accurate dictionary entry.",
  "Return ONLY a single JSON object — no prose, no markdown, no code fences — matching:",
  '{"headword": string, "pronunciation": string (IPA; omit the key if unsure),',
  '"senses": [{"partOfSpeech": string, "definition": string, "examples": string[]}],',
  '"etymology": string (origin and roots; omit the key if genuinely unknown),',
  '"contextualMeaning": string (what the term means specifically in the provided sentence; omit the key when no context is given)}.',
  "Requirements: write detailed, precise definitions — never a bare one-word gloss;",
  "give 1–2 natural example sentences per sense; cover the common senses of the term;",
  "include etymology whenever you know it.",
].join(" ");

/** 查一个词 / 短语，返回结构化词条。失败时抛出携带 provider 错误信息的 Error。 */
export async function lookUpWord(
  account: LlmAccount,
  models: RoleModels,
  input: LookUpInput,
): Promise<DictionaryEntry> {
  const registry = buildProviderRegistry();
  const resolveModel = createModelResolver(account, models, registry);
  const complete = createCompleteFn(registry, account);

  const userLines = [
    `Term to define: ${JSON.stringify(input.term)}.`,
    input.context ? `It appears in this passage: ${JSON.stringify(input.context)}.` : "",
    input.bookTitle ? `The book is ${JSON.stringify(input.bookTitle)}.` : "",
    `Write every human-readable field (definitions, part-of-speech labels, examples, etymology, contextual meaning) in ${input.explanationLanguage}.`,
    "Keep the headword itself in its original language.",
    "Respond with the JSON object only.",
  ].filter(Boolean);

  const message = await complete(resolveModel("fast"), {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userLines.join("\n"), timestamp: Date.now() }],
  });

  // completeSimple 不 reject：失败 resolve 成 stopReason "error"/"aborted" 的消息。
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? "dictionary lookup failed");
  }
  return parseEntry(extractText(message));
}

function parseSentenceExplanation(raw: string): SentenceExplanation {
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<SentenceExplanation>;

  const glosses: SentenceGloss[] = Array.isArray(parsed.glosses)
    ? parsed.glosses
        .filter(
          (gloss): gloss is SentenceGloss =>
            !!gloss &&
            typeof (gloss as SentenceGloss).term === "string" &&
            typeof (gloss as SentenceGloss).meaning === "string",
        )
        .map((gloss) => ({
          term: gloss.term.trim(),
          pronunciation: typeof gloss.pronunciation === "string" ? gloss.pronunciation : undefined,
          meaning: gloss.meaning,
        }))
        .filter((gloss) => gloss.term)
    : [];

  return {
    translation: typeof parsed.translation === "string" ? parsed.translation.trim() : "",
    glosses,
    note: typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : undefined,
  };
}

const SENTENCE_SYSTEM_PROMPT = [
  "You are a bilingual reading assistant embedded in a reading app.",
  "Given a sentence or short passage from a book, help the reader understand it.",
  "Return ONLY a single JSON object — no prose, no markdown, no code fences — matching:",
  '{"translation": string (a faithful, natural rendering of the whole passage in the requested language),',
  '"glosses": [{"term": string (the word or expression exactly as it appears in the passage, original language),',
  '"pronunciation": string (IPA; omit the key if unsure),',
  '"meaning": string (a concise explanation of what it means in this passage, in the requested language)}],',
  '"note": string (one short remark on grammar, idiom, or tone worth knowing; omit the key when nothing stands out)}.',
  "Requirements: gloss every word or expression a language learner might stumble on —",
  "skip only truly basic vocabulary (articles, pronouns, prepositions, elementary verbs and nouns);",
  "treat idioms and set phrases as one unit rather than word by word;",
  "keep glosses in the order the terms appear in the passage.",
].join(" ");

/** 解释一个句子 / 段落：整句翻译 + 逐词注解。失败时抛出携带 provider 错误信息的 Error。 */
export async function explainSentence(
  account: LlmAccount,
  models: RoleModels,
  input: ExplainSentenceInput,
): Promise<SentenceExplanation> {
  const registry = buildProviderRegistry();
  const resolveModel = createModelResolver(account, models, registry);
  const complete = createCompleteFn(registry, account);

  const userLines = [
    `Passage to explain: ${JSON.stringify(input.sentence)}.`,
    input.bookTitle ? `The book is ${JSON.stringify(input.bookTitle)}.` : "",
    `Write the translation, every gloss meaning, and the note in ${input.explanationLanguage}.`,
    "Keep each gloss's term in its original language.",
    "Respond with the JSON object only.",
  ].filter(Boolean);

  const message = await complete(resolveModel("fast"), {
    systemPrompt: SENTENCE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userLines.join("\n"), timestamp: Date.now() }],
  });

  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? "sentence explanation failed");
  }
  return parseSentenceExplanation(extractText(message));
}
