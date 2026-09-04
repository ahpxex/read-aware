import { describe, expect, test } from "bun:test";
import { DictdDict } from "../public/foliate-js/dict.js";

describe("vendored foliate runtime", () => {
  test("rejects DictZip data without the required FEXTRA flag", async () => {
    const header = new Uint8Array(12);
    header.set([31, 139, 8, 0]);

    const dictionary = new DictdDict();
    await expect(
      dictionary.loadDict(new Blob([header]), (data) => data),
    ).rejects.toThrow("Missing FEXTRA flag");
  });
});
