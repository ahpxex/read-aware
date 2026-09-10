import { expect, test } from "bun:test";
import type { HostUpdateState } from "@read-aware/core";
import { SoftwareUpdateController } from "./software-update-controller";

function fixture() {
  let state: HostUpdateState = { phase: "idle", currentVersion: null, availableVersion: null, progress: null, errorStage: null };
  let channel: "stable" | "beta" = "stable";
  const logs: unknown[] = [];
  const adapter = { supported: () => true, channel: () => channel, read: () => state,
    write: (next: HostUpdateState) => { state = next; }, version: async () => "1.0.0",
    check: async (): Promise<{ currentVersion: string; version: string } | null> => ({ currentVersion: "1.0.0", version: "1.1.0" }),
    install: async (_progress: (value: { phase: "downloading" | "installing"; progress: number | null }) => void): Promise<"installer-started" | "permission-required"> => "installer-started" };
  const controller = new SoftwareUpdateController(adapter, (_message, error) => logs.push(error));
  return { controller, adapter, logs, channel: (value: "stable" | "beta") => { channel = value; controller.channelChanged(); } };
}

test("native and external checks share one flight; cancelled caller does not cancel the shared result", async () => {
  const f = fixture(), release = Promise.withResolvers<{ currentVersion: string; version: string }>();
  let checks = 0;
  f.adapter.check = () => { checks++; return release.promise; };
  const abort = new AbortController();
  const a = f.controller.checkForUpdates(abort.signal), b = f.controller.checkForUpdates();
  await Bun.sleep(0);
  expect(checks).toBe(1); expect(f.controller.snapshot().phase).toBe("checking");
  const cancelled = a.then(() => null, error => error); abort.abort();
  release.resolve({ currentVersion: "1.0.0", version: "1.1.0" });
  expect(await cancelled).toBeInstanceOf(Error);
  expect(await b).toMatchObject({ phase: "available", checkedChannel: "stable", availableVersion: "1.1.0" });
  const before = checks;
  await expect(f.controller.checkForUpdates(abort.signal)).rejects.toThrow();
  expect(checks).toBe(before);
});

test("failed checks reject with safe codes, recover, and unsupported never means up to date", async () => {
  const f = fixture();
  f.adapter.check = async () => { throw Error("secret endpoint detail"); };
  await expect(f.controller.checkForUpdates()).rejects.toMatchObject({ code: "ipc/unknown", message: "Software update check failed" });
  expect(f.controller.snapshot()).toMatchObject({ phase: "error", errorStage: "check", availableVersion: null, checkedChannel: null });
  expect(f.logs).toHaveLength(1);
  f.adapter.check = async () => null;
  expect((await f.controller.checkForUpdates()).phase).toBe("up-to-date");
  await f.controller.loadCurrentVersion(); expect(f.controller.snapshot().currentVersion).toBe("1.0.0");
  f.adapter.supported = () => false;
  await expect(f.controller.checkForUpdates()).rejects.toMatchObject({ code: "ui/unavailable" });
});

test("channel changes invalidate candidates and reject stale checks even after changing back", async () => {
  const f = fixture();
  await f.controller.checkForUpdates(); f.channel("beta");
  expect(f.controller.snapshot()).toMatchObject({ phase: "idle", availableVersion: null, checkedChannel: null });
  await expect(f.controller.installUpdate()).rejects.toMatchObject({ code: "ui/unavailable" });
  const release = Promise.withResolvers<null>(); f.adapter.check = () => release.promise;
  const pending = f.controller.checkForUpdates();
  const rejected = pending.then(() => null, error => error);
  f.channel("stable"); f.channel("beta"); release.resolve(null);
  expect(await rejected).toMatchObject({ code: "ui/superseded" });
  expect(f.controller.snapshot().availableVersion).toBeNull();
});

test("checks cannot replace the candidate during installation; repeated install shares the host flight", async () => {
  const f = fixture(); await f.controller.checkForUpdates();
  let installs = 0; const release = Promise.withResolvers<"installer-started">();
  f.adapter.install = progress => { installs++; progress({ phase: "downloading", progress: 42 }); return release.promise; };
  const a = f.controller.installUpdate(), b = f.controller.installUpdate();
  await Bun.sleep(0);
  expect(installs).toBe(1); expect(f.controller.snapshot().progress).toBe(42);
  await expect(f.controller.checkForUpdates()).rejects.toMatchObject({ code: "ui/unavailable" });
  release.resolve("installer-started"); await a; await b;
  expect(f.controller.snapshot().phase).toBe("installer-open");
});
