/**
 * 逐轮记忆提炼（doc §4 写管道第 1 步）：轮末异步跑在 `fast` 档位上，
 * 绝不阻塞流式回复，失败静默（提炼永远不能弄坏一轮对话）。
 *
 * 保守闸门：一轮最多 3 条候选；区分用户自述 / 引用书内容 / 假设性发言，
 * 只有自述能成为 user scope 证据；命中已有记忆报 reinforced 而不是重复写入。
 */
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { CompleteFn } from "../models/complete";
import type { MemoryKind, MemoryRecord, MemoryScope } from "../ports";
import type { ThreadScope } from "../thread-scope";

export interface MemoryCandidate {
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
}

export interface ExtractionResult {
  newMemories: MemoryCandidate[];
  reinforcedIds: string[];
}

const EMPTY: ExtractionResult = { newMemories: [], reinforcedIds: [] };

const KINDS: readonly string[] = ["fact", "preference", "insight", "summary"];

function buildExtractionPrompt(scope: ThreadScope, existing: MemoryRecord[]): string {
  const scopeLine =
    scope.kind === "book"
      ? `Allowed scopes: "user" (durable facts/preferences about the reader) and "book" (insights tied to the book being read).`
      : `Allowed scopes: "user" (durable facts/preferences about the reader) and "global" (cross-book conclusions).`;
  const existingBlock = existing.length
    ? `Known memories (id → content):\n${existing
        .map((memory) => `${memory.id} → [${memory.kind}] ${memory.content}`)
        .join("\n")}`
    : "Known memories: (none)";
  return `You maintain a reader's long-term memory for a reading app. From the exchange below, extract AT MOST 3 memory candidates worth keeping for future conversations.

Hard rules:
- Be conservative. Most exchanges contain NOTHING worth remembering — then output empty lists. Never invent.
- Distinguish three kinds of speech: the reader's own statements (may become "user" scope), quoted book content (never a fact about the reader; at most a book-scope insight), and hypotheticals/rhetorical questions (never extract).
- ${scopeLine}
- If the exchange merely confirms or repeats a known memory, put that memory's id in "reinforced" instead of writing a duplicate.
- kind is one of: fact, preference, insight, summary.
- Each content is one self-contained sentence, in the reader's language.

${existingBlock}

Output STRICT JSON only, no prose, no code fences:
{"new": [{"scope": "...", "kind": "...", "content": "..."}], "reinforced": ["id"]}`;
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function parseJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function normalizeScope(raw: unknown, scope: ThreadScope): MemoryScope | undefined {
  if (raw === "user") return "user";
  if (raw === "book" && scope.kind === "book") return `book:${scope.bookId}`;
  if (raw === "global" && scope.kind === "global") return "global";
  return undefined;
}

export interface ExtractMemoriesInput {
  complete: CompleteFn;
  model: Model<Api>;
  scope: ThreadScope;
  userText: string;
  assistantText: string;
  existing: MemoryRecord[];
}

export async function extractMemories(input: ExtractMemoriesInput): Promise<ExtractionResult> {
  let message: AssistantMessage;
  try {
    message = await input.complete(input.model, {
      systemPrompt: buildExtractionPrompt(input.scope, input.existing),
      messages: [
        {
          role: "user",
          content: `READER: ${input.userText}\n\nASSISTANT: ${input.assistantText}`,
          timestamp: Date.now(),
        },
      ],
    });
  } catch {
    return EMPTY;
  }

  const parsed = parseJson(extractText(message));
  if (!parsed || typeof parsed !== "object") return EMPTY;
  const { new: rawNew, reinforced: rawReinforced } = parsed as {
    new?: unknown;
    reinforced?: unknown;
  };

  const knownIds = new Set(input.existing.map((memory) => memory.id));
  const reinforcedIds = Array.isArray(rawReinforced)
    ? rawReinforced.filter((id): id is string => typeof id === "string" && knownIds.has(id))
    : [];

  const newMemories: MemoryCandidate[] = [];
  if (Array.isArray(rawNew)) {
    for (const item of rawNew.slice(0, 3)) {
      if (!item || typeof item !== "object") continue;
      const { scope: rawScope, kind, content } = item as Record<string, unknown>;
      const memoryScope = normalizeScope(rawScope, input.scope);
      if (!memoryScope) continue;
      if (typeof kind !== "string" || !KINDS.includes(kind)) continue;
      if (typeof content !== "string" || !content.trim()) continue;
      newMemories.push({ scope: memoryScope, kind: kind as MemoryKind, content: content.trim() });
    }
  }
  return { newMemories, reinforcedIds };
}
