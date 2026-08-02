import type { ThreadChunk } from "../chunks";

export interface ReadingBehaviorExpectation {
  mustContain?: string[];
  mustNotContain?: string[];
  requiredAnyTool?: string[];
  forbiddenTools?: string[];
}

export interface ReadingBehaviorResult {
  answer: string;
  tools: Array<{
    id: string;
    name: string;
    args?: unknown;
    isError?: boolean;
    output?: string;
  }>;
  failures: string[];
}

const normalized = (value: string) => value.toLowerCase();

/**
 * Deterministic scoring for live-model reading scenarios. Content assertions
 * catch leaked reveals; tool assertions catch the retrieval path that caused
 * them, so a failure remains diagnosable instead of becoming a vague bad reply.
 */
export function evaluateReadingBehavior(
  chunks: ThreadChunk[],
  expectation: ReadingBehaviorExpectation,
): ReadingBehaviorResult {
  const answer = chunks
    .filter((chunk): chunk is Extract<ThreadChunk, { type: "text" }> => chunk.type === "text")
    .map((chunk) => chunk.text)
    .join("");
  const tools: ReadingBehaviorResult["tools"] = [];
  for (const chunk of chunks) {
    if (chunk.type !== "tool-step") continue;
    if (chunk.phase === "start") {
      tools.push({ id: chunk.id, name: chunk.tool, args: chunk.args });
      continue;
    }
    if (chunk.phase !== "end") continue;
    const tool = tools.find((entry) => entry.id === chunk.id);
    if (tool) {
      tool.isError = chunk.isError;
      tool.output = chunk.output;
    }
  }
  const answerKey = normalized(answer);
  const failures: string[] = [];

  for (const phrase of expectation.mustContain ?? []) {
    if (!answerKey.includes(normalized(phrase))) {
      failures.push(`answer did not contain required phrase: ${JSON.stringify(phrase)}`);
    }
  }
  for (const phrase of expectation.mustNotContain ?? []) {
    if (answerKey.includes(normalized(phrase))) {
      failures.push(`answer contained forbidden phrase: ${JSON.stringify(phrase)}`);
    }
  }
  if (
    expectation.requiredAnyTool?.length &&
    !tools.some((tool) => expectation.requiredAnyTool?.includes(tool.name))
  ) {
    failures.push(`none of the required tools ran: ${expectation.requiredAnyTool.join(", ")}`);
  }
  for (const name of expectation.forbiddenTools ?? []) {
    if (tools.some((tool) => tool.name === name)) {
      failures.push(`forbidden tool ran: ${name}`);
    }
  }

  return { answer, tools, failures };
}
