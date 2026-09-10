import { expect, test } from "bun:test";
import { normalizeUserProfileQuery, userProfilePage } from "./user-profile";

test("profile pages are bounded, revision-pinned and do not split Unicode pairs", async () => {
  const text = "a\ud83d\ude00bc";
  const first = await userProfilePage(text, { limit: 2 });
  expect(first).toMatchObject({ exists: true, text: "a", totalLength: 5, offset: 0, nextOffset: 1, format: "plain-text", persistence: "device-local" });
  const second = await userProfilePage(text, { offset: first.nextOffset!, limit: 2, expectedRevision: first.revision });
  expect(second.text).toBe("\ud83d\ude00"); expect(second.nextOffset).toBe(3);
  await expect(userProfilePage(text, { offset: 2, expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/invalid-query" });
  await expect(userProfilePage(text + "d", { offset: 3, expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/conflict" });
  expect((await userProfilePage(text, { offset: 5, expectedRevision: first.revision })).nextOffset).toBeNull();
  expect((await userProfilePage("x".repeat(20000))).text.length).toBe(4000);
});

test("absent and intentionally empty profiles are distinguishable", async () => {
  const absent = await userProfilePage(undefined), empty = await userProfilePage("");
  expect(absent).toMatchObject({ exists: false, text: "", nextOffset: null, totalLength: 0 });
  expect(empty.exists).toBe(true); expect(empty.revision).not.toBe(absent.revision);
});

test("profile queries reject injected authority and unpinned or invalid offsets", () => {
  expect(normalizeUserProfileQuery()).toEqual({ offset: 0, limit: 4000 });
  for (const query of [null, [], { offset: 1 }, { offset: -1 }, { offset: NaN }, { offset: null }, { limit: null },
    { limit: 1 }, { limit: 16001 }, { limit: 2.5 }, { fields: ["secrets"] }, { includePrivate: true }, { expectedRevision: "bad" }]) {
    expect(() => normalizeUserProfileQuery(query as never)).toThrow();
  }
});
