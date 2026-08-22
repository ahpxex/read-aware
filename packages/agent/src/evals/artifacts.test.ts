import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalArtifactStore } from "./artifacts";
import type { EvalRunPlan, EvalRunRecord, EvalSummary } from "./types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("eval artifact store", () => {
  test("writes an isolated, redacted, replayable run bundle", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "readaware-eval-artifacts-"));
    temporaryDirectories.push(cwd);
    const secret = "sk-super-secret-value-123456";
    const store = await EvalArtifactStore.create({ suiteId: "reading", cwd, secrets: [secret] });
    const plan: EvalRunPlan = {
      suiteId: "reading",
      suiteDisplayName: "阅读位置与剧透",
      definitionHash: "sha256:definition",
      suiteDescription: "Reading",
      repetitions: 1,
      timeoutMs: 100,
      scenarios: [
        {
          id: "cursor",
          description: "Cursor",
          tags: ["reading"],
          inputHash: "sha256:input",
        },
      ],
      variants: [{ id: "baseline", metadata: { provider: "test" } }],
    };
    const record: EvalRunRecord = {
      id: "reading:cursor:baseline:1",
      suiteId: "reading",
      scenarioId: "cursor",
      variantId: "baseline",
      repetition: 1,
      executionIndex: 1,
      status: "passed",
      startedAt: "2026-08-02T00:00:00.000Z",
      finishedAt: "2026-08-02T00:00:01.000Z",
      input: { prompt: `use ${secret}` },
      output: { answer: `never retain ${secret}` },
      assessment: { passed: true, score: 1, checks: [] },
      telemetry: { wallTimeMs: 1 },
    };
    const summary: EvalSummary = {
      suiteId: "reading",
      baselineVariantId: "baseline",
      generatedAt: "2026-08-02T00:00:01.000Z",
      runs: 1,
      passed: 1,
      failed: 0,
      errors: 0,
      byVariant: [],
      byScenario: [],
      byTag: [],
      comparisons: [],
    };

    await store.writePlan(plan);
    await store.writeRun(record);
    await store.writeSummary(summary, "# report\n");

    const manifest = await readFile(join(store.directory, "manifest.json"), "utf8");
    const run = await readFile(
      join(store.directory, "runs", "baseline", "cursor", "1.json"),
      "utf8",
    );
    const index = await readFile(join(store.directory, "runs.jsonl"), "utf8");
    expect(manifest).toContain('"schemaVersion": 2');
    expect(manifest).toContain('"provenance"');
    expect(manifest).toContain('"definitionHash": "sha256:definition"');
    expect(run).not.toContain(secret);
    expect(run).toContain("[REDACTED]");
    expect(JSON.parse(index)).toMatchObject({ status: "passed", scenarioId: "cursor" });
    expect(await readFile(join(store.directory, "report.md"), "utf8")).toBe("# report\n");
  });
});
