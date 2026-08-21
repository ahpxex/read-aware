/**
 * 叙事性分类器的真书回归：对注册表里每本 fixture 跑一次生产态的
 * classifyNarrativity（书名/作者 + 目录 + 正文开头样本，fast 档），比对
 * 注册表里的人工标注。分类错一本，围栏与纪要口径就整本走错——这是
 * 分类管线的最小活体测试，跑一次五个调用，秒级。
 *
 *   bun run eval:classify [--provider openrouter] [--model deepseek/deepseek-v4-flash-0731]
 */
import { classifyNarrativity } from "./memory/narrativity";
import { createModelResolver } from "./models/accounts";
import { createCompleteFn } from "./models/complete";
import { evalProviderRegistry } from "./evals/model-config";
import type { ChapterRef } from "./ports";
import { realBook, realBookSlugs } from "./evals/book-fixtures";
import { applyEvalRouting, resolveEvalModel } from "./evals/model-config";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const provider = argValue("--provider") ?? "openrouter";
const registry = evalProviderRegistry();
const resolved = resolveEvalModel(registry, provider, argValue("--model"));
const complete = createCompleteFn(registry, resolved.account, "off");
const model = createModelResolver(
  resolved.account,
  { smart: resolved.modelId, fast: resolved.modelId },
  registry,
)("fast");
const routedModel = applyEvalRouting(model);

let failures = 0;
for (const slug of realBookSlugs()) {
  const book = realBook(slug);
  const epub = book.epub();
  const toc: ChapterRef[] = epub.chapters.map((chapter, index) => ({
    index,
    title: chapter.title,
    chars: chapter.text.length,
  }));
  const sampleText = epub.chapters[book.spec.firstContentChapter]?.text ?? "";
  const verdict = await classifyNarrativity({
    complete,
    model: routedModel,
    title: book.title(),
    author: epub.author,
    toc,
    sampleText,
  });
  const expected = book.spec.narrativity;
  const ok = verdict === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}\t${slug}\texpected=${expected}\tgot=${verdict ?? "undefined (low confidence / parse failure)"}`,
  );
}
if (failures > 0) {
  console.error(`${failures} misclassification(s)`);
  process.exit(1);
}
