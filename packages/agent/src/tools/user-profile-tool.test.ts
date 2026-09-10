import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildMemoryTools } from "./memory-tools";
import type { ThreadScope } from "../thread-scope";

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
