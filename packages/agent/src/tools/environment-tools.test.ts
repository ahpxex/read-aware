import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildEnvironmentTools } from "./environment-tools";

test("environment tool queries the live shared port and rejects a cancelled result", async () => {
  const { deps } = createInMemoryDeps(); const [tool] = buildEnvironmentTools(deps);
  let calls = 0;
  deps.environment.snapshot = async () => ({ revision: ++calls, runtime: "desktop", platform: "linux", locale: "de", timeZone: "Europe/Berlin", utcOffsetMinutes: 120, networkHint: "offline" });
  const first = await tool!.execute("one", {}), second = await tool!.execute("two", {});
  expect(first.content[0]).toMatchObject({ type: "text" });
  expect(JSON.stringify(second.content)).toContain('\\"revision\\":2');
  const owner = new AbortController(); owner.abort(Error("cancelled"));
  await expect(tool!.execute("three", {}, owner.signal)).rejects.toThrow("cancelled");
  expect(calls).toBe(2);
});

test("cancellation during the port read cannot publish a late environment result", async () => {
  const { deps } = createInMemoryDeps();
  const snapshot = await deps.environment.snapshot();
  let resolve!: (value: typeof snapshot) => void;
  deps.environment.snapshot = () => new Promise(done => { resolve = done; });
  const owner = new AbortController();
  const pending = buildEnvironmentTools(deps)[0]!.execute("late", {}, owner.signal);
  owner.abort(Error("cancelled during read"));
  resolve(snapshot);
  await expect(pending).rejects.toThrow("cancelled during read");
});
