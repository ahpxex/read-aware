/**
 * 真书 digest fixture 生成器：对 fixtures/<slug>.epub 跑一遍真实的章节
 * 纪要管线（extractChapterDigest，口径取注册表里该书的叙事性），把产物
 * 写成 fixtures/<slug>-digests.json —— eval 场景以此获得"生产同形"的图
 * 切片，一次生成、入库为 fixture、永远确定。
 *
 * 用法（DeepSeek 为缺省 provider，key 解析与 eval runner 同源）：
 *   bun run eval:digests <slug> [--provider deepseek] [--model deepseek-v4-flash]
 *   bun run eval:digests santi --resume     # 续跑：保留已有章节，只补缺失
 *
 * 断点续跑是刻意设计：几十章的全书跑一次要几分钟，网络抖动不该从头再来。
 * 逐章落盘（每章成功即写文件），失败章打印后跳过，收尾统计缺失章号。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DIGEST_VERSION,
  extractChapterDigest,
  mergeCharacterRegistry,
} from "./memory/chapter-digest";
import { createModelResolver } from "./models/accounts";
import { createCompleteFn } from "./models/complete";
import { buildProviderRegistry } from "./models/registry";
import type { ChapterDigest } from "./ports";
import { realBook, realBookSlugs, type RealBookSlug } from "./evals/book-fixtures";
import { resolveEvalModel } from "./evals/model-config";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const slugArg = process.argv[2];
if (!slugArg || !(realBookSlugs() as string[]).includes(slugArg)) {
  console.error(`usage: bun run eval:digests <slug> [--provider p] [--model m] [--resume]`);
  console.error(`registered slugs: ${realBookSlugs().join(", ")}`);
  process.exit(1);
}
const slug = slugArg as RealBookSlug;
const book = realBook(slug);
const provider = argValue("--provider") ?? "deepseek";
const requestedModel = argValue("--model");
const resume = process.argv.includes("--resume");

const outPath = fileURLToPath(new URL(`../fixtures/${slug}-digests.json`, import.meta.url));

const registry = buildProviderRegistry();
const resolved = resolveEvalModel(registry, provider, requestedModel);
const complete = createCompleteFn(registry, resolved.account, "off");
const model = createModelResolver(
  resolved.account,
  { smart: resolved.modelId, fast: resolved.modelId },
  registry,
)("fast");

const epub = book.epub();
const flavor = book.spec.narrativity;
const digests = new Map<number, ChapterDigest>();
if (resume && existsSync(outPath)) {
  for (const digest of JSON.parse(readFileSync(outPath, "utf8")) as ChapterDigest[]) {
    if (digest.digestVersion >= DIGEST_VERSION && (digest.flavor ?? "narrative") === flavor) {
      digests.set(digest.chapterIndex, digest);
    }
  }
  console.log(`resuming: ${digests.size} chapters already digested`);
}

const persist = () => {
  const ordered = [...digests.values()].sort((a, b) => a.chapterIndex - b.chapterIndex);
  writeFileSync(outPath, `${JSON.stringify(ordered, null, 1)}\n`);
};

console.log(
  `digesting "${book.title()}" (${epub.chapters.length} chapters, flavor=${flavor}) with ${resolved.modelId}`,
);
const failed: number[] = [];
for (let index = 0; index < epub.chapters.length; index++) {
  if (digests.has(index)) continue;
  const chapter = epub.chapters[index]!;
  // 与产品管线同一门槛：没有实文的章节静默跳过（不算失败）。
  if (!chapter.text.trim()) continue;
  const known = mergeCharacterRegistry(
    [...digests.values()].sort((a, b) => a.chapterIndex - b.chapterIndex),
  );
  const digest = await extractChapterDigest({
    complete,
    model,
    chapterIndex: index,
    chapterTitle: chapter.title,
    chapterText: chapter.text,
    knownCharacters: known,
    flavor,
  });
  if (!digest) {
    failed.push(index);
    console.error(`  #${index} FAILED (${chapter.title ?? "untitled"})`);
    continue;
  }
  digests.set(index, digest);
  persist();
  console.log(
    `  #${index} ok — ${digest.characters.length} entities, ${digest.relations.length} edges (${chapter.title ?? "untitled"})`,
  );
}

persist();
console.log(`wrote ${digests.size} digests to ${outPath}`);
if (failed.length) {
  console.error(`FAILED chapters (re-run with --resume): ${failed.join(", ")}`);
  process.exit(1);
}
