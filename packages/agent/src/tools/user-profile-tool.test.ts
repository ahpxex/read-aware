import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildMemoryTools } from "./memory-tools";
import type { ThreadScope } from "../thread-scope";
import { buildProfileWriteTool } from "./user-profile-write-tool";

test("profile replacement approves the immutable full candidate in both scopes and detects competing edits", async () => {
  for (const scope of [{ kind: "global", threadId: "t" }, { kind: "book", bookId: "b" }] as ThreadScope[]) {
    const { deps, stores } = createInMemoryDeps({ profile: "Original" });
    const params = { summary: "User-confirmed preference", expectedRevision: (await deps.profile.readProfile()).revision };
    deps.interactions = { request: async request => {
      expect(request).toMatchObject({ kind: "permission", action: "update-profile", subject: params.summary });
      params.summary = "Changed during approval";
      return { optionId: "approve" };
    } };
    const tool = buildProfileWriteTool(scope, deps);
    await tool.execute("write", params);
    expect(stores.profile.summary).toBe("User-confirmed preference");
    params.expectedRevision = (await deps.profile.readProfile()).revision;
    deps.interactions.request = async () => { stores.profile.summary = "Another writer"; return { optionId: "approve" }; };
    await expect(tool.execute("conflict", params)).rejects.toMatchObject({ code: "memory/conflict" });
    expect(stores.profile.summary).toBe("Another writer");
    params.expectedRevision = (await deps.profile.readProfile()).revision;
    deps.interactions.request = async () => ({ optionId: "decline" });
    await tool.execute("decline", params);
    expect(stores.profile.summary).toBe("Another writer");
    deps.interactions.request = async () => ({ optionId: "approve" });
    await tool.execute("clear", { ...params, summary: "" });
    expect(stores.profile.summary).toBe("");
    await expect(tool.execute("invalid", { ...params, summary: "x".repeat(16001) })).rejects.toMatchObject({ code: "memory/invalid-input" });
    await expect(tool.execute("extra", { ...params, confirmed: true })).rejects.toMatchObject({ code: "memory/invalid-input" });
    await expect(tool.execute("cancelled", params, AbortSignal.abort())).rejects.toBeDefined();
  }
});

test("both thread scopes query the shared user profile without writing or inferring fields", async () => {
  for (const scope of [{ kind: "global", threadId: "t" }, { kind: "book", bookId: "b" }] as ThreadScope[]) {
    const { deps, stores } = createInMemoryDeps({ profile: "Existing reader profile" });
    const tool = buildMemoryTools(scope, deps).find(tool => tool.name === "get_user_profile")!;
    const original = deps.profile.readProfile; let received: unknown;
    deps.profile.readProfile = async (...args) => { received = args; return original(...args); };
    const controller = new AbortController();
    const result = await tool.execute("profile", { limit: 8 }, controller.signal);
    expect(received).toEqual([{ offset: 0, limit: 8 }, controller.signal]);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(stores.profile.summary).toBe("Existing reader profile");
    await expect(tool.execute("profile", { fields: ["email"] })).rejects.toMatchObject({ code: "memory/invalid-query" });
    deps.profile.readProfile = async () => { throw new AppError("db/locked", "private"); };
    await expect(tool.execute("profile", {})).rejects.toMatchObject({ code: "db/locked" });
  }
});
