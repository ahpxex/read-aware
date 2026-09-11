import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { deferred, profileHost } from "../../tests/helpers/profile-host";

test("initialization retries failure, shares in-flight work and broadcasts only actual migrated bytes", async () => {
  const host = await profileHost("Durable legacy");
  host.controls.initializationFailure = new AppError("db/locked", "retry");
  await expect(host.service.read()).rejects.toMatchObject({ code: "db/locked" });
  expect(host.broadcasts).toHaveLength(0);
  host.controls.initializationFailure = undefined; host.controls.migrated = true;
  expect(await Promise.all([host.service.read(), host.service.read()])).toEqual(["Durable legacy", "Durable legacy"]);
  expect(host.calls.filter(call => call.command === "profile_initialize")).toHaveLength(2);
  expect(host.calls.filter(call => call.command === "profile_initialize")[1]).toMatchObject({ args: { event: { origin: "system", payload: {} } } });
  expect(host.broadcasts).toEqual([{ type: "profile.updated", payload: { summary: "Durable legacy" }, origin: "system" }]);
});

test("reads always inspect the projection, propagate failures and cancel late results", async () => {
  const host = await profileHost();
  const first = await host.service.page();
  await host.remote("Changed remotely");
  expect(await host.service.read()).toBe("Changed remotely");
  await expect(host.service.page({ expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/conflict" });
  host.controls.readFailure = new AppError("db/locked", "private details");
  await expect(host.service.read()).rejects.toMatchObject({ code: "db/locked" });
  host.controls.readFailure = undefined;
  const entered = deferred(), gate = deferred(), controller = new AbortController();
  host.controls.beforeRead = () => { entered.resolve(); return gate.promise; };
  const pending = host.service.page({}, controller.signal);
  await entered.promise; controller.abort(); gate.resolve();
  await expect(pending).rejects.toBeDefined();
});

test("writes carry immutable candidate, origin and observed native revision, and drain after dispatch", async () => {
  const host = await profileHost(), old = host.current();
  await host.service.initialize();
  const entered = deferred(), gate = deferred(), controller = new AbortController();
  host.controls.beforeCommit = () => { entered.resolve(); return gate.promise; };
  const input = { summary: "Candidate", expectedRevision: old.revision };
  const pending = host.service.change(input, "plugin:profile", controller.signal);
  input.summary = "Mutated";
  await entered.promise;
  expect(host.current()).toEqual(old); expect(host.broadcasts).toHaveLength(0);
  controller.abort(); gate.resolve();
  expect(await pending).toMatchObject({ changed: true, persistence: "event-log" });
  expect(host.current().summary).toBe("Candidate");
  expect(host.calls.at(-1)).toMatchObject({ command: "profile_commit", args: { expectedRevision: old.revision, event: { origin: "plugin:profile", payload: { summary: "Candidate" } } } });
  expect(host.broadcasts).toEqual([{ type: "profile.updated", payload: { summary: "Candidate" }, origin: "plugin:profile" }]);
});

test("conflicting and failed transactions do not publish success or silently retry", async () => {
  const host = await profileHost();
  const input = { summary: "First", expectedRevision: host.current().revision };
  const results = await Promise.allSettled([host.service.change(input, "agent"), host.service.change({ ...input, summary: "Second" }, "agent")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "memory/conflict" } });
  expect(host.broadcasts).toHaveLength(1);
  const committed = host.current();
  host.controls.beforeCommit = async () => { throw new AppError("db/locked", "fault"); };
  await expect(host.service.change({ summary: "Failed", expectedRevision: committed.revision }, "agent")).rejects.toMatchObject({ code: "db/locked" });
  expect(host.current()).toEqual(committed); expect(host.broadcasts).toHaveLength(1);
});

test("cancellation before dispatch prevents the candidate write; no-op does not broadcast", async () => {
  const host = await profileHost(); await host.service.initialize();
  const input = { summary: "Cancelled", expectedRevision: host.current().revision };
  await expect(host.service.change(input, "agent", AbortSignal.abort())).rejects.toBeDefined();
  const entered = deferred(), gate = deferred(), controller = new AbortController();
  host.controls.beforeMint = () => { entered.resolve(); return gate.promise; };
  const pending = host.service.change(input, "agent", controller.signal);
  await entered.promise; controller.abort(); gate.resolve();
  await expect(pending).rejects.toBeDefined();
  expect(host.calls.some(call => call.command === "profile_commit")).toBe(false);
  host.controls.beforeMint = async () => {};
  expect(await host.service.change({ ...input, summary: "Original" }, "agent")).toMatchObject({ changed: false });
  expect(host.broadcasts).toHaveLength(0);
});

test("onboarding and host-only archive restore both use conditional event writes", async () => {
  const host = await profileHost();
  await host.service.put("Onboarding");
  expect(host.current().summary).toBe("Onboarding");
  const summary = "x".repeat(16001), observed = host.current().revision;
  await expect(host.service.change({ summary, expectedRevision: observed }, "agent")).rejects.toMatchObject({ code: "memory/invalid-input" });
  await host.service.restore(summary, observed);
  expect(host.calls.at(-1)).toMatchObject({ command: "profile_restore", args: { expectedRevision: observed, event: { origin: "user", payload: { summary } } } });
  expect(host.current().summary).toBe(summary);
});
