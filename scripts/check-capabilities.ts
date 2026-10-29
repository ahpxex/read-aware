import { resolve } from "node:path";

/** Separate processes keep module mocks and browser globals out of sibling suites. */
export const capabilityChecks = [
  { name: "Documentation links", args: ["scripts/check-docs.ts", "--with-capabilities"] },
  { name: "Prepare generated Foliate runtime", args: ["run", "--filter", "@read-aware/web", "build:foliate"] },
  { name: "Capability audit script types", args: ["x", "tsc", "--noEmit", "-p", "scripts/tsconfig.capabilities.json"] },
  { name: "Capability data types", args: ["x", "tsc", "--noEmit", "-p", "docs/capabilities"] },
  { name: "Matrix source and generated evidence", args: ["scripts/build-host-capability-matrix.ts", "--check"] },
  { name: "Ownership model and generated evidence", args: ["scripts/build-host-capability-model.ts", "--check"] },
  { name: "Inventory omission and ownership guards", args: ["test", "scripts"] },
  { name: "Core contracts", args: ["test", "packages/core/src"] },
  { name: "Agent contracts", args: ["test", "packages/agent/src"] },
  { name: "Host domains", args: ["test", "apps/web/src/domain"] },
  {
    name: "Network transfer and approved download contracts",
    args: [
      "test",
      "apps/web/src/services/network-transfer-budget.test.ts",
      "apps/web/src/services/network-retry.test.ts",
      "apps/web/src/services/resource-download.test.ts",
    ],
  },
  { name: "Plugin runtime contracts", args: ["test", "apps/web/src/features/plugins/runtime"] },
  {
    name: "Worker boundary and actual Worker transport",
    args: [
      "test",
      "apps/web/src/features/plugins/runtime/plugin-worker-host.test.ts",
      "apps/web/src/features/plugins/runtime/plugin-sandbox.integration.test.ts",
    ],
  },
  {
    name: "Native migration bridge and KV ordering",
    args: ["test", "apps/web/tests/plugin-data-snapshot.test.ts", "apps/web/src/platform/kv-write-queue.test.ts"],
  },
  {
    name: "Actor and desktop type contracts",
    // Turbo directly: the root `typecheck` script chains a repo-level tsc that would
    // receive the filters as compiler options.
    args: [
      "x",
      "turbo",
      "run",
      "typecheck",
      "--filter=@read-aware/core",
      "--filter=@read-aware/agent",
      "--filter=@read-aware/plugin-types",
      "--filter=@read-aware/web",
      "--filter=@read-aware/desktop",
    ],
  },
] as const;

if (import.meta.main) {
  for (const check of capabilityChecks) {
    console.log(`\n[capabilities] ${check.name}`);
    const child = Bun.spawn([process.execPath, ...check.args], {
      cwd: resolve(import.meta.dir, ".."),
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await child.exited;
    if (code !== 0) {
      console.error(`[capabilities] Failed: ${check.name} (exit ${code})`);
      process.exit(code || 1);
    }
  }
  console.log("\n[capabilities] Source and contract checks passed. Desktop product acceptance is separate.");
}
