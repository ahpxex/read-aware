/**
 * Release dirty-work: translate the newest English changelog entry into every
 * landing locale via the pi CLI on Ollama Cloud. Used by the publishing flow
 * (see .claude/skills/publishing) — the main agent writes ONLY the English
 * entry; this script fans it out.
 *
 * bun scripts/translate-changelog.ts [--version 0.5.0] [--locales ja,de,...]
 *
 * Why the harness looks paranoid (all behaviors observed live, 2026-08-30):
 * - Hosted completion endpoints INTERMITTENTLY stall forever (Ollama Cloud
 *   produced nothing for 6+ minutes on a task that normally takes ~70s), so
 *   every attempt gets a hard timeout and retries regardless of provider.
 * - Long generations must not run concurrently on one key (parallel runs
 *   starve each other in the cloud queue); locales run SERIALLY.
 * - Output is validated structurally (same JSON shape as the English entry,
 *   version/date/kind preserved verbatim) before anything is written; a
 *   model's bad day can cost a retry, never a corrupted locale file.
 *
 * The style anchor: each locale's prompt embeds that locale's most recent
 * EXISTING entry, so terminology and tone follow the site's established
 * voice instead of the model's defaults.
 *
 * Machine prerequisite: `pi auth check --provider zai-coding-cn` must say
 * ready (the Zhipu coding-plan key in the pi CLI auth store). Verified live
 * 2026-08-30: glm-5.3 does the full entry in ~55s with correct structure.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RESOURCES = join(import.meta.dir, "../apps/landing/src/i18n/resources");
const PROVIDER = "zai-coding-cn";
const MODEL_LADDER = ["glm-5.3", "glm-5.3-flash"];
const ATTEMPT_TIMEOUT_S = 180;
const ATTEMPTS_PER_MODEL = 2;

const LOCALES: Record<string, string> = {
  zh: "Simplified Chinese",
  "zh-hant": "Traditional Chinese (Taiwan conventions)",
  ja: "Japanese",
  de: "German",
  es: "Spanish",
  fr: "French",
  ru: "Russian",
};

type Entry = {
  version: string;
  date: string;
  summary: string;
  groups: Array<{ kind: string; items: Array<{ title: string; body: string }> }>;
};

function readEntries(locale: string): { data: Record<string, unknown>; entries: Entry[] } {
  const path = join(RESOURCES, `${locale}.site.json`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  return { data, entries: (data.changelog as { entries: Entry[] }).entries };
}

function buildPrompt(language: string, styleAnchor: Entry | undefined, entry: Entry): string {
  return [
    `You are the release-notes translator for ReadAware, a desktop reading app. Translate the JSON changelog entry below from English into ${language}.`,
    "",
    "Rules:",
    "- Output ONLY the translated JSON object — no prose, no code fences.",
    '- Preserve the JSON structure and every key exactly. Never translate keys, "version", "date", or "kind" values.',
    '- Translate only the human-readable values: "summary", "title", "body".',
    '- Product name "ReadAware" stays in Latin script. UI terms should match the app\'s conventions visible in the style sample.',
    "- Tone: match the style sample — plain, precise, quietly enthusiastic release notes; no marketing fluff.",
    "- For Chinese and Japanese, use full-width CJK punctuation (，。：；！？——) exactly as the style sample does; never half-width commas or periods in prose.",
    "- Do not add quotation marks, brackets, or any decoration around \"title\" values — they are bare phrases.",
    ...(styleAnchor
      ? [
          "",
          `Style sample (an earlier entry already translated into ${language}):`,
          JSON.stringify(styleAnchor, null, 1),
        ]
      : []),
    "",
    "Entry to translate:",
    JSON.stringify(entry, null, 1),
  ].join("\n");
}

/** Same tree of types/keys — a wrong shape means the model freelanced. */
function sameShape(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameShape(item, b[i]))
    );
  }
  if (typeof a === "object" && a !== null) {
    if (typeof b !== "object" || b === null) return false;
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b as object).sort();
    return (
      ka.length === kb.length &&
      ka.every(
        (k, i) =>
          k === kb[i] &&
          sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return typeof a === typeof b;
}

function validate(candidate: unknown, source: Entry): candidate is Entry {
  if (!sameShape(candidate, source)) return false;
  const entry = candidate as Entry;
  if (entry.version !== source.version || entry.date !== source.date) return false;
  return entry.groups.every((group, i) => group.kind === source.groups[i]!.kind);
}

function attempt(model: string, prompt: string): Entry | null {
  const run = spawnSync(
    "timeout",
    [
      String(ATTEMPT_TIMEOUT_S),
      "pi",
      "--provider",
      PROVIDER,
      "--model",
      model,
      "--no-session",
      "--no-tools",
      "-p",
      prompt,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (run.status !== 0 || !run.stdout.trim()) return null;
  // Tolerate stray fences even though the prompt forbids them.
  const raw = run.stdout.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(raw) as Entry;
  } catch {
    return null;
  }
}

function translate(language: string, styleAnchor: Entry | undefined, entry: Entry): Entry {
  const prompt = buildPrompt(language, styleAnchor, entry);
  for (const model of MODEL_LADDER) {
    for (let n = 1; n <= ATTEMPTS_PER_MODEL; n += 1) {
      const started = Date.now();
      const result = attempt(model, prompt);
      const seconds = Math.round((Date.now() - started) / 1000);
      if (result && validate(result, entry)) {
        console.log(`  ${model} attempt ${n}: ok in ${seconds}s`);
        return result;
      }
      console.log(`  ${model} attempt ${n}: failed after ${seconds}s (stall/invalid), retrying`);
    }
  }
  throw new Error(`all attempts exhausted for ${language}`);
}

// ── main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const versionArg = args.includes("--version") ? args[args.indexOf("--version") + 1] : undefined;
const localesArg = args.includes("--locales")
  ? args[args.indexOf("--locales") + 1]!.split(",")
  : Object.keys(LOCALES);

const { entries: enEntries } = readEntries("en");
const source = versionArg
  ? enEntries.find((entry) => entry.version === versionArg)
  : enEntries[0];
if (!source) throw new Error(`no English changelog entry for ${versionArg ?? "(latest)"}`);
console.log(`Translating changelog entry v${source.version} → ${localesArg.join(", ")}`);

const failures: string[] = [];
for (const locale of localesArg) {
  const language = LOCALES[locale];
  if (!language) throw new Error(`unknown locale ${locale}`);
  console.log(`\n${locale} (${language}):`);
  const { data, entries } = readEntries(locale);
  const anchor = entries.find((entry) => entry.version !== source.version);
  let translated: Entry;
  try {
    translated = translate(language, anchor, source);
  } catch (error) {
    console.error(`  GIVING UP on ${locale}: ${error}`);
    failures.push(locale);
    continue;
  }
  const existing = entries.findIndex((entry) => entry.version === source.version);
  if (existing >= 0) entries[existing] = translated;
  else entries.unshift(translated);
  writeFileSync(
    join(RESOURCES, `${locale}.site.json`),
    JSON.stringify(data, null, 2) + "\n",
  );
  console.log(`  wrote ${locale}.site.json`);
}

if (failures.length > 0) {
  console.error(`\nFAILED locales (fix by hand or re-run): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll locales translated. Review the diffs before committing.");
