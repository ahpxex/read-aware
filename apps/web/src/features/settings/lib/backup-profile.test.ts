import { expect, spyOn, test } from "bun:test";
import { AppError, userProfileRevision, type UserProfileSnapshot } from "@read-aware/core";
import * as profile from "../../../domain/user-profile";
import * as kv from "../../../platform/local-store";
import * as library from "../../library/lib/library-db";
import * as annotations from "../../annotations/lib/annotation-db";
import { exportBackup, importBackup } from "./backup-io";

test("v1 export materializes only the current summary and never resurrects a stale legacy key", async () => {
  let current: UserProfileSnapshot = { summary: "Event summary", revision: await userProfileRevision("Event summary", "event") };
  const read = spyOn(profile, "readUserProfileSnapshot").mockImplementation(async () => current);
  const mocks = [read,
    spyOn(kv, "dumpLocalKV").mockResolvedValue({ [profile.LEGACY_PROFILE_KEY]: "Stale cache", "read-aware-theme": "paper" }),
    spyOn(library, "listLibraryBooks").mockResolvedValue([]),
    spyOn(library, "listCollections").mockResolvedValue([]),
    spyOn(annotations, "listAnnotations").mockResolvedValue([]),
  ];
  try {
    const initial = JSON.parse(await exportBackup());
    expect(initial.version).toBe(1);
    expect(initial.kv).toEqual({ [profile.LEGACY_PROFILE_KEY]: "Event summary", "read-aware-theme": "paper" });
    current = { ...current, summary: null };
    expect(JSON.parse(await exportBackup()).kv).not.toHaveProperty(profile.LEGACY_PROFILE_KEY);
    current = { ...current, summary: "" };
    expect(JSON.parse(await exportBackup()).kv[profile.LEGACY_PROFILE_KEY]).toBe("");
    read.mockRejectedValue(new AppError("db/locked", "private"));
    await expect(exportBackup()).rejects.toMatchObject({ code: "db/locked" });
  } finally { for (const mock of mocks) mock.mockRestore(); }
});

test("v1 import separates large historical summary from KV and carries the pre-restore revision", async () => {
  const observed = { summary: "Current", revision: await userProfileRevision("Current", "event") };
  const read = spyOn(profile, "readUserProfileSnapshot").mockResolvedValue(observed);
  const restore = spyOn(profile, "restoreUserProfile").mockResolvedValue({ changed: true, revision: "next", persistence: "event-log" });
  const write = spyOn(kv, "restoreLocalKV").mockImplementation(async values => {
    expect(values).not.toHaveProperty(profile.LEGACY_PROFILE_KEY);
  });
  const json = (values: Record<string, unknown>) => JSON.stringify({ app: "read-aware", kind: "backup", version: 1, books: [], kv: values });
  try {
    const summary = "x".repeat(20000);
    expect(await importBackup(json({ [profile.LEGACY_PROFILE_KEY]: summary, "read-aware-theme": "paper" }))).toMatchObject({ settings: 2 });
    expect(write).toHaveBeenLastCalledWith({ "read-aware-theme": "paper" });
    expect(restore).toHaveBeenLastCalledWith(summary, observed.revision);
    await importBackup(json({ [profile.LEGACY_PROFILE_KEY]: "" }));
    expect(restore).toHaveBeenLastCalledWith("", observed.revision);
    const reads = read.mock.calls.length, writes = restore.mock.calls.length;
    await importBackup(json({ "read-aware-theme": "dark" }));
    expect(read).toHaveBeenCalledTimes(reads); expect(restore).toHaveBeenCalledTimes(writes);
    const kvWrites = write.mock.calls.length;
    await expect(importBackup(json({ [profile.LEGACY_PROFILE_KEY]: null }))).rejects.toThrow("Invalid backup profile");
    expect(write).toHaveBeenCalledTimes(kvWrites);
    restore.mockRejectedValue(new AppError("memory/conflict", "changed during KV restore"));
    await expect(importBackup(json({ [profile.LEGACY_PROFILE_KEY]: "Do not overwrite blindly" }))).rejects.toMatchObject({ code: "memory/conflict" });
    expect(restore).toHaveBeenCalledTimes(writes + 1);
  } finally { read.mockRestore(); restore.mockRestore(); write.mockRestore(); }
});
