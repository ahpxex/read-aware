import { expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { HostDiagnosticsService, projectionVerificationSummary } from "./diagnostics-controller";
import { verifyProjectionReport, type ProjectionReport } from "../platform/projection-verification";
import * as ipc from "../platform/ipc";

const report: ProjectionReport = { consistent: false, eventsReplayed: 12, drift: [
  { table: "private-table", onlyLive: 2, onlyReplayed: 1, samples: ["PRIVATE ROW CONTENT"] },
  { table: "another-table", onlyLive: 0, onlyReplayed: 3, samples: ["PRIVATE ID"] },
] };

test("verification exposes aggregate counts only and fails closed on malformed reports", () => {
  const result = projectionVerificationSummary(report);
  expect(result).toEqual({ scope: "event-projections", checkedAt: expect.any(String), consistent: false,
    eventsReplayed: 12, driftedTables: 2, onlyLiveRows: 2, onlyReplayedRows: 4 });
  expect(JSON.stringify(result)).not.toContain("private");
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  for (const value of [null, {}, { ...report, consistent: true }, { ...report, eventsReplayed: -1 },
    { ...report, drift: [null] }, { ...report, drift: [{ onlyLive: 0, onlyReplayed: 0 }] },
    { ...report, drift: [{ onlyLive: 1.5, onlyReplayed: 0 }] },
  ]) expect(() => projectionVerificationSummary(value)).toThrow();
  expect(projectionVerificationSummary({ consistent: true, eventsReplayed: 0, drift: [] })).toMatchObject({ consistent: true, driftedTables: 0 });
});

test("call cancellation releases the waiter, not the shared native operation; every result is independent", async () => {
  const gate = Promise.withResolvers<unknown>();
  let calls = 0;
  const service = new HostDiagnosticsService({ supported: () => true, verify: () => { calls++; return gate.promise; } }, () => {});
  const controller = new AbortController();
  const cancelled = service.verifyProjections(controller.signal);
  const sibling = service.verifyProjections();
  controller.abort(new Error("cancel waiter"));
  await expect(cancelled).rejects.toThrow("cancel waiter");
  const later = service.verifyProjections();
  expect(calls).toBe(1);
  gate.resolve(report);
  const [first, second] = await Promise.all([sibling, later]);
  first.onlyLiveRows = 999;
  expect(second.onlyLiveRows).toBe(2);
  expect(first.checkedAt).toBe(second.checkedAt);
  await service.verifyProjections();
  expect(calls).toBe(2);
});

test("unsupported and pre-aborted calls do not dispatch; incomplete logs and failures never mean consistent", async () => {
  const errors: unknown[] = [];
  let calls = 0, supported = false;
  const failure = new AppError("sync/log-incomplete", "backfill pending");
  const service = new HostDiagnosticsService({ supported: () => supported, verify: async () => { calls++; throw failure; } }, error => errors.push(error));
  expect(() => service.verifyProjections()).toThrow();
  supported = true;
  expect(() => service.verifyProjections(AbortSignal.abort())).toThrow();
  expect(calls).toBe(0);
  await expect(service.verifyProjections()).rejects.toBe(failure);
  await expect(service.verifyProjections()).rejects.toBe(failure);
  expect(calls).toBe(2); expect(errors).toEqual([failure, failure]);
});

test("settings diagnostics and actor diagnostics share the same native verification flight", async () => {
  const gate = Promise.withResolvers<ProjectionReport>();
  const invoke = spyOn(ipc, "invoke").mockImplementation(async () => gate.promise as never);
  const service = new HostDiagnosticsService({ supported: () => true, verify: verifyProjectionReport }, () => {});
  try {
    const settings = verifyProjectionReport(), actor = service.verifyProjections();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("verify_projections");
    gate.resolve(report);
    expect(await settings).toBe(report);
    expect(await actor).toMatchObject({ onlyLiveRows: 2, onlyReplayedRows: 4 });
  } finally { gate.resolve(report); await gate.promise; invoke.mockRestore(); }
});
