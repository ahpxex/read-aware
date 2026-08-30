/**
 * 叙事性分类（书型判定）：这本书是叙事作品（小说/传记/叙事史——后文
 * 事件构成剧透）还是说明文类（技术/论著/教程/参考——后文只是更多内容）？
 * 判定结果是两条管线的分流信号：剧透围栏（narrative 未读完启用硬闸）
 * 与章节纪要口径（人物图 vs 概念图）。
 *
 * 证据只取书自己的：书名/作者 + 目录 + 正文开头样本。fast 档一次调用，
 * 严格 JSON 输出；任何失败返回 undefined（调用方跳过，下个空闲节拍再试）
 * ——错分类比晚分类毒得多，宁缺毋滥。
 */
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { CompleteFn } from "../models/complete";
import type { AgentLogPort, ChapterRef } from "../ports";

/** 目录样本上限：够看出体裁（"第一章 xxx" vs "3.2 配置参数"），不必全量。 */
const MAX_TOC_TITLES = 60;
/** 正文样本上限：开头几段足以区分散文叙事与论说/操作文体。 */
const SAMPLE_TEXT_BUDGET = 3_000;

const CLASSIFY_PROMPT = `You classify ONE book for a reading companion. Decide whether it is primarily a NARRATIVE work or an EXPOSITORY work, from the evidence below only.

- "narrative": fiction, memoirs, biographies, narrative history — works where later events, revelations, identities, or outcomes are part of the reading experience, so spoiler protection matters.
- "expository": technical, scientific, argumentative, instructional, self-help, reference — works read for understanding, where connecting later sections freely IMPROVES explanations.

Anthologies and collected works: classify by the dominant content (a fiction anthology is "narrative").
If the evidence is genuinely mixed or insufficient, pick the closest fit anyway — but report lower confidence.

Output STRICT JSON only, no prose, no code fences:
{"narrativity": "narrative" | "expository", "confidence": 0.0-1.0}`;

/** confidence 低于该值视为判定失败——下个节拍带着更多已读文本再试。 */
const MIN_CONFIDENCE = 0.6;

export interface ClassifyNarrativityInput {
  log?: AgentLogPort;
  complete: CompleteFn;
  model: Model<Api>;
  title: string;
  author?: string;
  toc: ChapterRef[];
  /** 正文开头样本（跳过版权页等空转章节后的第一段实文）。 */
  sampleText: string;
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** 分类单本书；任何失败（含低置信）返回 undefined。 */
export async function classifyNarrativity(
  input: ClassifyNarrativityInput,
): Promise<"narrative" | "expository" | undefined> {
  const tocLines = input.toc
    .slice(0, MAX_TOC_TITLES)
    .map((chapter) => `- ${chapter.title || "(untitled)"}`)
    .join("\n");
  const evidence = [
    `Title: ${input.title}`,
    ...(input.author ? [`Author: ${input.author}`] : []),
    `Table of contents (first ${Math.min(input.toc.length, MAX_TOC_TITLES)} of ${input.toc.length} entries):\n${tocLines || "(empty)"}`,
    `Opening text sample:\n${input.sampleText.slice(0, SAMPLE_TEXT_BUDGET)}`,
  ].join("\n\n");
  let message: AssistantMessage;
  try {
    message = await input.complete(input.model, {
      systemPrompt: CLASSIFY_PROMPT,
      messages: [{ role: "user", content: evidence, timestamp: Date.now() }],
    });
  } catch (error) {
    // The book simply stays unclassified (digests fall back to "narrative"),
    // but the failure must be visible or classification looks perpetually idle.
    input.log?.warn("narrativity classification failed", error);
    return undefined;
  }
  const raw = extractText(message).replace(/```(?:json)?/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const { narrativity, confidence } = parsed as Record<string, unknown>;
  if (narrativity !== "narrative" && narrativity !== "expository") return undefined;
  if (typeof confidence === "number" && confidence < MIN_CONFIDENCE) return undefined;
  return narrativity;
}
