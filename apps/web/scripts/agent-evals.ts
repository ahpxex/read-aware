/**
 * Agent evals on the app's headless host.
 *
 *   bun scripts/agent-evals.ts <suite> [eval options]   # from apps/web, or `bun run eval:agent` in packages/agent
 *   bun scripts/agent-evals.ts snapshots                # rewrite the eval books' snapshots from the app's extraction
 *
 * The books of the real-book suites are opened, parsed, extracted, searched and
 * located by the app's own code over a headless shell (tests/headless). Before
 * anything runs, each book's snapshot — the data scenarios are written against —
 * is compared with what the app extracts now; a stale snapshot stops the run.
 */
import { writeFileSync } from "node:fs";
import { installEvalHost, realBookSlugs, realBookSnapshotFile, runEvalCli } from "@read-aware/agent/evals";
import { addEvalBooks, createAppEvalHost, extractEvalBook, readEvalBookSnapshot } from "../tests/headless/eval-host";
import { installHeadlessShell } from "../tests/headless/shell";

const args = process.argv.slice(2);
const shell = await installHeadlessShell();
addEvalBooks(shell);

if (args[0] === "snapshots") {
  const only = args.slice(1);
  for (const slug of realBookSlugs().filter((entry) => !only.length || only.includes(entry))) {
    const snapshot = await extractEvalBook(slug);
    writeFileSync(realBookSnapshotFile(slug), `${JSON.stringify(snapshot)}\n`);
    const blocks = snapshot.chapters.reduce((sum, chapter) => sum + (chapter.layout?.paragraphs.length ?? 0), 0);
    console.log(`${slug}: ${snapshot.chapters.length} chapters, ${blocks} blocks, ${snapshot.contentVersion}`);
  }
  process.exit(0);
}

const stale: string[] = [];
for (const slug of realBookSlugs()) {
  const stored = readEvalBookSnapshot(slug);
  // A book without a snapshot is not read through the app yet.
  if (stored && JSON.stringify(stored) !== JSON.stringify(await extractEvalBook(slug))) stale.push(slug);
}
if (stale.length) {
  console.error(
    `The app no longer extracts ${stale.join(", ")} as the snapshot records. Scenarios are written against the snapshot: ` +
      "review what changed, then run `bun run eval:snapshots` in apps/web and re-derive any chapter coordinates.",
  );
  process.exit(1);
}

installEvalHost(createAppEvalHost());
await runEvalCli(args);
process.exit(process.exitCode ?? 0);
