import { expect, test } from "bun:test";
import { conversationContextBundle, type ConversationInsightsSnapshot } from "./context-bundle-insights";
import { validateContextBundle } from "./context-bundle";
import golden from "./context-bundle-insights.golden.json";

async function signed(input: Omit<ConversationInsightsSnapshot, "revision">): Promise<ConversationInsightsSnapshot> {
  const tuple = ["conversation-insights", 1, input.target.kind, input.target.id, input.status, input.summary];
  return { ...input, revision: `cins1:${new Bun.CryptoHasher("sha256").update(JSON.stringify(tuple)).digest("hex")}` };
}
const fixture = () => structuredClone(golden) as ConversationInsightsSnapshot;

test("shared native snapshot forms an exact scoped artifact with full Unicode summary", async () => {
  const input = fixture(), bundle = await conversationContextBundle(input, input.target);
  expect(bundle.content).toMatchObject({ scope: input.target, kind: "conversation_insights_context", sourceRevision: input.revision,
    items: [{ kind: "conversation_insight", id: input.target.id, revision: input.revision, text: input.summary }], omissions: [] });
  expect(await validateContextBundle(bundle)).toEqual(bundle);
  expect(await conversationContextBundle(fixture(), input.target)).toEqual(bundle);
  const global = await signed({ target: { kind: "global", id: "thread-other" }, status: "present", summary: "Global" });
  expect((await conversationContextBundle(global, global.target)).content.scope).toEqual({ kind: "conversation", id: "thread-other" });
});

test("explicit empty, absent and unavailable are distinct versioned outcomes", async () => {
  const target = fixture().target, versions: string[] = [];
  for (const status of ["present", "absent", "unavailable"] as const) {
    const input = await signed({ target, status, summary: status === "present" ? "" : null });
    const bundle = await conversationContextBundle(input, target); versions.push(bundle.version);
    expect(bundle.content.items).toHaveLength(status === "present" ? 1 : 0);
    expect(bundle.content.omissions).toEqual(status === "unavailable" ? [{ kind: "conversation_insight", reason: "unavailable", count: 1 }] : []);
  }
  expect(new Set(versions).size).toBe(3);
});

test("snapshots cannot change target, add raw fields, forge revision or contradict availability", async () => {
  const input = fixture();
  for (const value of [null, { ...input, messages: "private" }, { ...input, revision: "forged" },
    { ...input, target: { ...input.target, key: "private" } }, { ...input, status: "unknown" },
    { ...input, status: "absent" }, { ...input, summary: null }, { ...input, target: { kind: "book", id: "another" } }]) {
    await expect(conversationContextBundle(value as ConversationInsightsSnapshot, input.target)).rejects.toMatchObject({ code: "memory/invalid-input" });
  }
  await expect(conversationContextBundle(input, { kind: "global", id: "book:one" })).rejects.toMatchObject({ code: "ui/invalid-target" });
});

test("capture copies mutable snapshots before hashing and rejects oversized or invalid text", async () => {
  const input = fixture(), original = fixture(), target = { ...input.target };
  const pending = conversationContextBundle(input, target); input.summary = "changed"; target.id = "retargeted";
  expect(await pending).toEqual(await conversationContextBundle(original, original.target));
  for (const summary of ["x".repeat(1024 * 1024), "\u4e2d".repeat(400_000), "bad\u0000text", "bad\uD800text"]) {
    const snapshot = await signed({ target: original.target, status: "present", summary });
    await expect(conversationContextBundle(snapshot, snapshot.target)).rejects.toMatchObject({ code: "memory/invalid-input" });
  }
});
