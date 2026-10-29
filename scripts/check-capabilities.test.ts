import { expect, test } from "bun:test";
import { capabilityChecks } from "./check-capabilities";

test("capability gate is repeatable, read-only for evidence and keeps stateful suites isolated", () => {
  expect(new Set(capabilityChecks.map((check) => check.name)).size).toBe(capabilityChecks.length);
  for (const script of ["scripts/build-host-capability-matrix.ts", "scripts/build-host-capability-model.ts"] as const) {
    expect(capabilityChecks.find((check) => check.args[0] === script)?.args).toEqual([script, "--check"]);
  }
  for (const path of [
    "scripts",
    "packages/core/src",
    "packages/agent/src",
    "apps/web/src/domain",
    "apps/web/src/features/plugins/runtime",
  ]) {
    expect(
      capabilityChecks.some((check) => check.args[0] === "test" && check.args.length === 2 && check.args[1] === path),
    ).toBe(true);
  }
  const worker = capabilityChecks.find((check) => check.name === "Worker boundary and actual Worker transport");
  expect(worker?.args).toContain("apps/web/src/features/plugins/runtime/plugin-sandbox.integration.test.ts");
  const manifest = Bun.file(new URL("../package.json", import.meta.url));
  return manifest
    .json()
    .then((value) => expect(value.scripts["check:capabilities"]).toBe("bun scripts/check-capabilities.ts"));
});
