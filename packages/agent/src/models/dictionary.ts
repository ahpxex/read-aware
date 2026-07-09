/**
 * 词典查词（Reader 选中 / 导航条 → Look up）：用 fast 档发一次结构化补全，
 * 返回一份详尽的词条 —— 音标、分义项的详细释义与例句、词源，以及该词在给定
 * 语境（当前句子）里的具体含义。与 chat 共用同一套 pi-ai provider 栈，绝不
 * 另起 HTTP 客户端（同 test-connection 的约定）。
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

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** 从模型输出里抠出 JSON 词条（容忍 ```json 围栏与前后废话）。 */
function parseEntry(raw: string): DictionaryEntry {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("dictionary response contained no JSON object");
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<DictionaryEntry>;

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
