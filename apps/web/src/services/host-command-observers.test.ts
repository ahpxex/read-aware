import { expect, test } from "bun:test";
import { AppError, type HostCommandObservation, type HostCommandSnapshot } from "@read-aware/core";
import { HostCommandObservers } from "./host-command-observers";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const snapshot = (workspaceRevision: number): HostCommandSnapshot => ({ version: 1, workspaceRevision, commands: [] });

test("command observations discard stale reads, coalesce slow handlers and recover with stable errors", async () => {
  const errors: unknown[] = [], hub = new HostCommandObservers(error => errors.push(error));
  const reads: { resolve(value: HostCommandSnapshot): void; reject(error: unknown): void; signal: AbortSignal }[] = [];
  const seen: HostCommandObservation[] = [];
  let invalidate!: () => void, releaseHandler!: () => void, released = 0;
  const dispose = hub.observe(signal => new Promise((resolve, reject) => reads.push({ signal, resolve, reject })),
    notify => { invalidate = notify; return () => { released++; }; }, async state => {
      seen.push(state); if (seen.length === 1) await new Promise<void>(resolve => { releaseHandler = resolve; });
    });
  invalidate(); reads.shift()!.resolve(snapshot(1)); await tick();
  expect(seen).toEqual([]); expect(reads).toHaveLength(1);
  reads.shift()!.resolve(snapshot(2)); await tick(); expect(seen).toHaveLength(1);
  invalidate(); invalidate(); expect(reads).toHaveLength(0);
  releaseHandler(); await tick(); expect(reads).toHaveLength(1);
  reads.shift()!.reject(new AppError("db/locked", "private failure")); await tick();
  expect(seen[1]).toEqual({ revision: 2, status: "error", code: "db/locked" });
  invalidate(); reads.shift()!.resolve(snapshot(3)); await tick();
  expect(seen[2]).toEqual({ revision: 3, status: "ready", snapshot: snapshot(3) });
  invalidate(); reads.shift()!.resolve(snapshot(3)); await tick(); expect(seen).toHaveLength(3);
  invalidate(); const late = reads.shift()!; dispose(); dispose();
  expect(late.signal.aborted).toBe(true); late.resolve(snapshot(4)); await tick();
  expect(released).toBe(1); expect(seen).toHaveLength(3); expect(errors).toHaveLength(1);
});

test("observer registration failures release capacity and handler failures do not kill later delivery", async () => {
  const errors: unknown[] = [], hub = new HostCommandObservers(e => errors.push(e));
  for (let i = 0; i < 70; i++) expect(() => hub.observe(async () => snapshot(0), () => { throw Error("subscribe"); }, () => {})).toThrow("subscribe");
  const disposers: (() => void)[] = [];
  for (let i = 0; i < 64; i++) disposers.push(hub.observe(async () => snapshot(0), () => () => {}, () => {}));
  expect(() => hub.observe(async () => snapshot(0), () => () => {}, () => {})).toThrow("Too many command observers");
  disposers.forEach(dispose => dispose());
  let invalidate!: () => void, revision = 0, calls = 0;
  const dispose = hub.observe(async () => snapshot(revision), notify => { invalidate = notify; return () => {}; }, () => {
    calls++; if (calls === 1) throw Error("consumer");
  });
  await tick(); revision++; invalidate(); await tick();
  expect(calls).toBe(2); expect(errors).toHaveLength(1); dispose();
});
