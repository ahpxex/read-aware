import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { redactUnknown } from "./json";
import type { EvalRunPlan, EvalRunRecord, EvalSummary, JsonValue } from "./types";

export interface EvalArtifactStoreOptions {
  suiteId: string;
  cwd?: string;
  rootDir?: string;
  secrets?: string[];
}

export interface EvalGitMetadata {
  commit?: string;
  branch?: string;
  dirty?: boolean;
}

function safeSegment(value: string): string {
  const segment = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return segment || "unnamed";
}

function timestampSegment(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function runGit(cwd: string, args: string[]): string | undefined {
  try {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) return undefined;
    const value = result.stdout.toString().trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function collectGitMetadata(cwd: string): EvalGitMetadata {
  const status = runGit(cwd, ["status", "--porcelain"]);
  return {
    commit: runGit(cwd, ["rev-parse", "HEAD"]),
    branch: runGit(cwd, ["branch", "--show-current"]),
    ...(status === undefined ? {} : { dirty: status.length > 0 }),
  };
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function pretty(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class EvalArtifactStore {
  readonly runId: string;
  readonly directory: string;

  private readonly cwd: string;
  private readonly secrets: string[];
  private readonly createdAt: string;

  private constructor(input: {
    runId: string;
    directory: string;
    cwd: string;
    secrets: string[];
    createdAt: string;
  }) {
    this.runId = input.runId;
    this.directory = input.directory;
    this.cwd = input.cwd;
    this.secrets = input.secrets;
    this.createdAt = input.createdAt;
  }

  static async create(options: EvalArtifactStoreOptions): Promise<EvalArtifactStore> {
    const cwd = resolve(options.cwd ?? process.cwd());
    const created = new Date();
    const runId = `${safeSegment(options.suiteId)}-${timestampSegment(created)}-${randomUUID().slice(0, 8)}`;
    const root = resolve(cwd, options.rootDir ?? ".eval");
    const directory = join(root, runId);
    await mkdir(join(directory, "runs"), { recursive: true });
    return new EvalArtifactStore({
      runId,
      directory,
      cwd,
      secrets: options.secrets ?? [],
      createdAt: created.toISOString(),
    });
  }

  private sanitize(value: unknown): JsonValue {
    return redactUnknown(value, this.secrets);
  }

  async writePlan(plan: EvalRunPlan): Promise<void> {
    const manifest = this.sanitize({
      schemaVersion: 1,
      runId: this.runId,
      createdAt: this.createdAt,
      cwd: this.cwd,
      git: collectGitMetadata(this.cwd),
      runtime: {
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
      },
      plan,
    });
    await atomicWrite(join(this.directory, "manifest.json"), pretty(manifest));
  }

  async writeRun(record: EvalRunRecord): Promise<void> {
    const sanitized = this.sanitize(record);
    const directory = join(
      this.directory,
      "runs",
      safeSegment(record.variantId),
      safeSegment(record.scenarioId),
    );
    await mkdir(directory, { recursive: true });
    await Promise.all([
      atomicWrite(join(directory, `${record.repetition}.json`), pretty(sanitized)),
      appendFile(join(this.directory, "runs.jsonl"), `${JSON.stringify(sanitized)}\n`, "utf8"),
    ]);
  }

  async writeSummary(summary: EvalSummary, markdown: string): Promise<void> {
    await Promise.all([
      atomicWrite(join(this.directory, "summary.json"), pretty(this.sanitize(summary))),
      atomicWrite(join(this.directory, "report.md"), markdown),
    ]);
  }
}
