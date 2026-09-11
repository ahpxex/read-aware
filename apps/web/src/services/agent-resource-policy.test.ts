import { expect, test } from "bun:test";
import type { ResourceRef } from "@read-aware/core";
import { agentResourceReadPolicy } from "./resources";

test("the Agent may read picked, created, downloaded and image bytes, but books and context bundles stay export-only", () => {
  const ref = (source: ResourceRef["source"]): ResourceRef => ({ id: "r", name: "r", mimeType: "application/octet-stream", size: 1, state: "ready", expiresAt: 1, source });
  for (const source of ["picked", "created", "cover", "image"] as const) expect(() => agentResourceReadPolicy(ref(source))).not.toThrow();
  expect(() => agentResourceReadPolicy(ref("book"))).toThrow(expect.objectContaining({ code: "memory/forbidden" }));
  expect(() => agentResourceReadPolicy(ref("context"))).toThrow(expect.objectContaining({ code: "memory/forbidden", message: expect.stringContaining("read_context_bundle") }));
});
