import { expect, test } from "bun:test";
import { TextUnitBuild } from "./text-unit-build";

test("replacement settles an abandoned build even when its provider never answers", async () => {
  const session = new TextUnitBuild();
  const first = session.run(() => new Promise<never>(() => {}));
  const second = await session.run(async () => "current");
  expect(await first).toBeNull();
  expect(second).toMatchObject({ status: "ready", value: "current" });
  expect(second?.isCurrent()).toBe(true);
  session.invalidate();
  expect(second?.isCurrent()).toBe(false);
});

test("invalidation before dispatch does not invoke the provider", async () => {
  const session = new TextUnitBuild();
  let calls = 0;
  const work = session.run(async () => { calls++; return []; });
  session.invalidate();
  expect(await work).toBeNull();
  expect(calls).toBe(0);
});

test("late failures from retired work do not become failures of the new build", async () => {
  const session = new TextUnitBuild();
  let reject!: (error: unknown) => void;
  const old = session.run(() => new Promise((_resolve, fail) => { reject = fail; }));
  await Promise.resolve();
  const current = await session.run(async () => ["new"]);
  reject(new Error("retired"));
  expect(await old).toBeNull();
  expect(current).toMatchObject({ status: "ready", value: ["new"] });
  session.invalidate();
});

test("failure is distinct from a successful empty section", async () => {
  const session = new TextUnitBuild();
  const empty = await session.run(async () => []);
  const failed = await session.run(async () => { throw new Error("provider failed"); });
  expect(empty).toMatchObject({ status: "ready", value: [] });
  expect(failed).toMatchObject({ status: "failed", error: { message: "provider failed" } });
  expect(empty?.isCurrent()).toBe(false);
  session.invalidate();
});

test("timeout aborts the pipeline and late replies have no successful continuation", async () => {
  const session = new TextUnitBuild(10);
  let signal!: AbortSignal, finish!: (value: string) => void;
  const work = session.run(next => { signal = next; return new Promise(resolve => { finish = resolve; }); });
  expect(await work).toMatchObject({ status: "failed", error: { code: "reader/timeout" } });
  expect(signal.aborted).toBe(true);
  finish("late");
  const current = await session.run(async () => "retry");
  expect(current).toMatchObject({ status: "ready", value: "retry" });
  session.invalidate();
});
