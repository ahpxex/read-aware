import { expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { buildSystemPrompt } from "../context/system-prompt";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";
import { TOOL_FAMILIES } from "./tool-families";
import { createAgentTurnState } from "./turn-state";

/** Every description string in a schema, however deeply nested. */
function descriptions(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) descriptions(item, out);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      if (key === "description" && typeof child === "string") out.push(child);
      else descriptions(child, out);
    }
  return out;
}

test("model-facing text names only tools the model can call", () => {
  // Family members are internal operations; the model reaches them as family(request.operation=…).
  const retired = [
    ...TOOL_FAMILIES.flatMap((family) => Object.values(family.members)),
    "get_navigation_toc",
    "edit_annotation",
  ];
  const { deps } = createInMemoryDeps({ books: [{ id: "b" as Id, title: "Book", status: "reading" }] });
  const texts: string[] = [];
  for (const scope of [
    { kind: "book", bookId: "b" as Id },
    { kind: "global", threadId: "g" },
  ] as const) {
    for (const tool of buildAgentTools(scope, deps, createAgentTurnState()))
      texts.push(tool.description, ...descriptions(tool.parameters));
    texts.push(buildSystemPrompt(scope, { book: { id: "b" as Id, title: "Book", status: "reading" } }));
  }
  const pattern = new RegExp(`\\b(${retired.join("|")})\\b`, "g");
  const found = new Set(texts.flatMap((text) => text.match(pattern) ?? []));
  expect([...found]).toEqual([]);
});
