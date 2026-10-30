import { expect, test } from "bun:test";
import { join } from "node:path";
import { version } from "../package.json";

function runCli(...args: string[]) {
  return Bun.spawnSync([process.execPath, join(import.meta.dir, "index.ts"), ...args]);
}

test("prints help with no arguments", () => {
  const result = runCli();
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Usage: read-aware [options]");
  expect(result.stderr.toString()).toBe("");
});

test.each(["--help", "-h"])("prints help for %s", (flag) => {
  const result = runCli(flag);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("--help");
  expect(result.stdout.toString()).toContain("--version");
  expect(result.stderr.toString()).toBe("");
});

test.each(["--version", "-v"])("prints the package version for %s", (flag) => {
  const result = runCli(flag);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe(version);
  expect(result.stderr.toString()).toBe("");
});

test.each(["--unknown", "unknown"])("rejects unsupported argument %s", (arg) => {
  const result = runCli(arg);
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toContain("Run read-aware --help for usage.");
});
