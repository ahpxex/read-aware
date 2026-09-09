import { expect, test } from "bun:test";
import { errorCode } from "@read-aware/core";
import { decodeChapterDigestRows } from "./chapter-digest-row";

const row = () => ({ bookId: "b", chapterIndex: 0, chapterHref: "first.xhtml", summary: "Persisted summary",
  charactersJson: JSON.stringify([{ name: "Ada", aliases: ["A"], note: "Known person", ignored: "not public" }]),
  relationsJson: JSON.stringify([{ from: "Ada", kind: "knows", to: "Ben", note: "Earlier chapter" }]), digestVersion: 2, flavor: "narrative" });
test("projection decoding preserves edition spellings, validates the full shape and copies only public fields", () => {
  const result = decodeChapterDigestRows([row()], "b");
  expect(result).toEqual([{ chapterIndex: 0, chapterHref: "first.xhtml", summary: "Persisted summary",
    characters: [{ name: "Ada", aliases: ["A"], note: "Known person" }],
    relations: [{ from: "Ada", kind: "knows", to: "Ben", note: "Earlier chapter" }], digestVersion: 2, flavor: "narrative" }]);
  result[0]!.characters[0]!.aliases!.push("mutated");
  expect(decodeChapterDigestRows([row()], "b")[0]!.characters[0]!.aliases).toEqual(["A"]);
  expect(decodeChapterDigestRows([], "b")).toEqual([]);
});
test("legacy missing flavor and provenance remain valid but unknown flavor never becomes narrative", () => {
  for (const flavor of [null, undefined]) {
    const [digest] = decodeChapterDigestRows([{ ...row(), chapterHref: null, flavor }], "b");
    expect(digest?.flavor).toBeUndefined(); expect(digest?.chapterHref).toBeUndefined();
  }
  expect(() => decodeChapterDigestRows([{ ...row(), flavor: "unsupported" }], "b")).toThrow();
});
test("malformed rows reject the entire read with a stable code and no persisted content in errors", () => {
  const malformed = [null, {}, [null], [row(), row()], ...[
    { bookId: "other" }, { chapterIndex: -1 }, { chapterIndex: 1.5 }, { chapterIndex: Number.MAX_SAFE_INTEGER + 1 },
    { summary: null }, { chapterHref: 3 }, { digestVersion: 0 }, { digestVersion: "2" },
    { charactersJson: "PRIVATE invalid JSON" }, { charactersJson: "{}" }, { charactersJson: "[null]" },
    { charactersJson: '[{"name":"Ada","aliases":"PRIVATE"}]' }, { charactersJson: '[{"name":"Ada","aliases":[3]}]' },
    { charactersJson: '[{"name":"Ada","note":{}}]' }, { charactersJson: '[{"name":" "}]' },
    { relationsJson: "PRIVATE invalid JSON" }, { relationsJson: "{}" }, { relationsJson: "[null]" },
    { relationsJson: '[{"from":"Ada","kind":"knows","to":1}]' },
    { relationsJson: '[{"from":"Ada","kind":"knows","to":"Ben","note":false}]' },
  ].map(patch => [{ ...row(), ...patch }])];
  for (const value of malformed) {
    let failure: unknown;
    try { decodeChapterDigestRows(value, "b"); } catch (error) { failure = error; }
    expect(errorCode(failure)).toBe("db/error");
    expect(String(failure)).not.toContain("PRIVATE");
  }
  expect(() => decodeChapterDigestRows([row(), { ...row(), chapterIndex: 1, charactersJson: "{" }], "b")).toThrow();
});
