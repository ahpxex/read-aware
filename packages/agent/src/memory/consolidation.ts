/**
 * 巩固批处理（doc §4 写管道第 3 步）—— 记忆库不退化成噪音的机制：
 *   1. 衰减（确定性代码）：久未强化的低证据记忆降置信，跌破阈值即遗忘
 *   2. 去重合并 / 矛盾消解 / book→global 升格（fast 模型判断 + 代码闸门）
 * 由宿主在空闲时触发（AgentRuntime.consolidate()）；所有变更经
 * MemoryPort.applyMemoryChanges 落库，实现方翻译成 memory.* 事件。
 */
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { CompleteFn } from "../models/complete";
import type { MemoryChange, MemoryPort, MemoryRecord } from "../ports";

// ---- 衰减（纯函数，可独立测试） --------------------------------------------

const DECAY_AFTER_DAYS = 30;
const DECAY_FACTOR = 0.85;
const FORGET_BELOW = 0.15;

export function decayChanges(memories: MemoryRecord[], now: number): MemoryChange[] {
  const changes: MemoryChange[] = [];
  for (const memory of memories) {
    if (memory.pinned) continue;
    const ageDays = (now - Date.parse(memory.updatedAt)) / 86_400_000;
    if (ageDays < DECAY_AFTER_DAYS) continue;
    const decayed = Number((memory.importance * DECAY_FACTOR).toFixed(3));
    if (decayed < FORGET_BELOW && memory.evidenceCount < 2) {
      changes.push({ type: "forget", id: memory.id });
    } else if (decayed < memory.importance) {
      changes.push({ type: "decay", id: memory.id, importance: decayed });
    }
  }
  return changes;
}

// ---- LLM 判断：合并 / 矛盾 / 升格 -------------------------------------------

const CONSOLIDATION_PROMPT = `You are the consolidation pass over a reader's long-term memory store. Given the memory list, propose:
- "merges": pairs where two memories state substantially the same thing (any scope). keep = the better-phrased/higher-evidence one, drop = the duplicate.
- "contradictions": pairs where memories conflict. winner = the newer or better-evidenced one, loser = the outdated one.
- "promotions": memories in a book scope that are really about the reader themself or a cross-book pattern, worth promoting. scope = "user" or "global".

Be conservative: when unsure, propose nothing. Do not invent ids.
Output STRICT JSON only:
{"merges": [{"keep": "id", "drop": "id"}], "contradictions": [{"winner": "id", "loser": "id"}], "promotions": [{"id": "id", "scope": "user"}]}`;

/** 升格闸门：模型提议之外的硬条件（doc §4：反复出现才升格）。 */
const PROMOTE_MIN_EVIDENCE = 3;

function messageText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}

async function judgementChanges(
  memories: MemoryRecord[],
  complete: CompleteFn,
  model: Model<Api>,
): Promise<MemoryChange[]> {
  if (memories.length < 2) return [];
  const listing = memories
    .map(
      (memory) =>
        `${memory.id} [${memory.scope}] [${memory.kind}] evidence=${memory.evidenceCount} :: ${memory.content}`,
    )
    .join("\n");
  let parsed: Record<string, unknown> | undefined;
  try {
    const message = await complete(model, {
      systemPrompt: CONSOLIDATION_PROMPT,
      messages: [{ role: "user", content: listing, timestamp: Date.now() }],
    });
    parsed = parseJson(messageText(message));
  } catch {
    return [];
  }
  if (!parsed) return [];

  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const changes: MemoryChange[] = [];
  const touched = new Set<string>();
  const touch = (...ids: string[]) => ids.forEach((id) => touched.add(id));

  const { merges, contradictions, promotions } = parsed as {
    merges?: Array<{ keep?: unknown; drop?: unknown }>;
    contradictions?: Array<{ winner?: unknown; loser?: unknown }>;
    promotions?: Array<{ id?: unknown; scope?: unknown }>;
  };

  for (const merge of Array.isArray(merges) ? merges : []) {
    const keep = typeof merge.keep === "string" ? byId.get(merge.keep) : undefined;
    const drop = typeof merge.drop === "string" ? byId.get(merge.drop) : undefined;
    if (!keep || !drop || keep.id === drop.id || touched.has(drop.id)) continue;
    changes.push({ type: "supersede", id: drop.id, byId: keep.id });
    touch(drop.id);
  }

  for (const conflict of Array.isArray(contradictions) ? contradictions : []) {
    const winner = typeof conflict.winner === "string" ? byId.get(conflict.winner) : undefined;
    const loser = typeof conflict.loser === "string" ? byId.get(conflict.loser) : undefined;
    if (!winner || !loser || winner.id === loser.id || touched.has(loser.id)) continue;
    changes.push({ type: "supersede", id: loser.id, byId: winner.id });
    touch(loser.id);
  }

  for (const promotion of Array.isArray(promotions) ? promotions : []) {
    const memory = typeof promotion.id === "string" ? byId.get(promotion.id) : undefined;
    if (!memory || touched.has(memory.id)) continue;
    if (!memory.scope.startsWith("book:")) continue;
    if (memory.evidenceCount < PROMOTE_MIN_EVIDENCE) continue;
    if (promotion.scope !== "user" && promotion.scope !== "global") continue;
    changes.push({ type: "promote", id: memory.id, scope: promotion.scope });
    touch(memory.id);
  }

  return changes;
}

// ---- 入口 -------------------------------------------------------------------

export interface ConsolidationReport {
  decayed: number;
  forgotten: number;
  merged: number;
  promoted: number;
}

export interface RunConsolidationInput {
  memory: MemoryPort;
  complete: CompleteFn;
  model: Model<Api>;
  /** 注入时钟便于测试；缺省取当前时间 */
  now?: number;
}

export async function runConsolidation(input: RunConsolidationInput): Promise<ConsolidationReport> {
  const now = input.now ?? Date.now();
  const memories = await input.memory.listMemories();

  const decay = decayChanges(memories, now);
  const forgottenIds = new Set(
    decay.filter((change) => change.type === "forget").map((change) => change.id),
  );
  const remaining = memories.filter((memory) => !forgottenIds.has(memory.id));
  const judged = await judgementChanges(remaining, input.complete, input.model);

  const changes = [...decay, ...judged];
  if (changes.length) await input.memory.applyMemoryChanges(changes);

  return {
    decayed: decay.filter((change) => change.type === "decay").length,
    forgotten: forgottenIds.size,
    merged: judged.filter((change) => change.type === "supersede").length,
    promoted: judged.filter((change) => change.type === "promote").length,
  };
}
