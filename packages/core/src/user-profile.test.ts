import { expect, test } from "bun:test";
import { normalizeUserProfileQuery, userProfilePage, userProfileRevision, type UserProfileQuery } from "./user-profile";

const page = async (summary: string | null, query?: UserProfileQuery, event = "seed") =>
  userProfilePage({ summary, revision: await userProfileRevision(summary, event) }, query);

test("profile pages are bounded, revision-pinned and do not split Unicode pairs", async () => {
  const text = "a\ud83d\ude00bc";
  const first = await page(text, { limit: 2 });
  expect(first).toMatchObject({ exists: true, text: "a", totalLength: 5, offset: 0, nextOffset: 1, format: "plain-text", persistence: "event-log" });
  const second = await page(text, { offset: first.nextOffset!, limit: 2, expectedRevision: first.revision });
  expect(second.text).toBe("\ud83d\ude00"); expect(second.nextOffset).toBe(3);
  await expect(page(text, { offset: 2, expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/invalid-query" });
  await expect(page(text + "d", { offset: 3, expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/conflict" });
  await expect(page(text, { expectedRevision: first.revision }, "new-event")).rejects.toMatchObject({ code: "memory/conflict" });
  expect((await page(text, { offset: 5, expectedRevision: first.revision })).nextOffset).toBeNull();
  expect((await page("x".repeat(20000))).text.length).toBe(4000);
});

test("absent and intentionally empty profiles are distinguishable", async () => {
  const absent = await page(null), empty = await page("");
  expect(absent).toMatchObject({ exists: false, text: "", nextOffset: null, totalLength: 0 });
  expect(empty.exists).toBe(true); expect(empty.revision).not.toBe(absent.revision);
});

test("profile queries reject injected authority and unpinned or invalid offsets", () => {
  expect(normalizeUserProfileQuery()).toEqual({ offset: 0, limit: 4000 });
  for (const query of [null, [], { offset: 1 }, { offset: -1 }, { offset: NaN }, { offset: null }, { limit: null },
    { limit: 1 }, { limit: 16001 }, { limit: 2.5 }, { fields: ["secrets"] }, { includePrivate: true },
    { expectedRevision: "bad" }, { expectedRevision: "profile1:" + "a".repeat(64) }]) {
    expect(() => normalizeUserProfileQuery(query as never)).toThrow();
  }
});

test("profile2 hashes match native JSON vectors, including escaped and astral text", async () => {
  expect(await userProfileRevision(null, null)).toBe("profile2:95cb9b4f84ceff132cc7a875d8c192bf4997016a939ee64141c1fd628c0e8738");
  expect(await userProfileRevision("", "empty")).toBe("profile2:2752489527d1a5bf09b2a33bc0717669fee43cd4be25e647da573d7e9c94be05");
  expect(await userProfileRevision("line\n\"\\\u0000\u2028\u2029\ud83d\ude42", "unicode")).toBe("profile2:5ee26de549c1b20e5e0a6ab3b628ccaa991fc5aa03bcd302cb5af046519abdbc");
});
