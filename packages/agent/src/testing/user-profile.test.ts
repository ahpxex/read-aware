import { expect, test } from "bun:test";
import { createProfileFixture } from "./user-profile";

test("profile fixture follows native ABA, concurrent decisions and no-op semantics", async () => {
  const state = { summary: "A" }, profile = createProfileFixture(state);
  const first = await profile.readProfile();
  const noop = await profile.updateProfile({ summary: "A", expectedRevision: first.revision });
  expect(noop).toEqual({ changed: false, revision: first.revision, persistence: "event-log" });
  await profile.putProfileSummary("B");
  await profile.putProfileSummary("A");
  await expect(profile.updateProfile({ summary: "Late", expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/conflict" });
  const fresh = await profile.readProfile();
  const result = await Promise.allSettled(["One", "Two"].map(summary => profile.updateProfile({ summary, expectedRevision: fresh.revision })));
  expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(result.find(item => item.status === "rejected")).toMatchObject({ reason: { code: "memory/conflict" } });
});
