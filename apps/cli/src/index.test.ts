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

test.each([
  ["--unknown", "Unknown option '--unknown'"],
  ["unknown", "Unexpected argument 'unknown'"],
  ["--version=3", "does not take an argument"],
])("rejects unsupported argument %s with a plain message", (arg, message) => {
  const result = runCli(arg);
  const stderr = result.stderr.toString();
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe("");
  expect(stderr).toContain(`read-aware: `);
  expect(stderr).toContain(message);
  expect(stderr).toContain("Run read-aware --help for usage.");
  // No source frame, stack trace or error code leaks into user-facing output.
  expect(stderr.trim().split("\n")).toHaveLength(2);
  expect(stderr).not.toMatch(/^\s+at /m);
  expect(stderr).not.toContain("ERR_PARSE_ARGS");
});
