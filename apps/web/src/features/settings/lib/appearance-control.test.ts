import { describe, expect, test } from "bun:test";
import { builtinThemesFor } from "./appearance-control";

describe("built-in appearance vocabulary", () => {
  test("keeps app and reader surfaces distinct", () => {
    expect(builtinThemesFor("app").map((theme) => theme.value)).toEqual([
      "system",
      "light",
      "dark",
    ]);
    expect(builtinThemesFor("reader").map((theme) => theme.value)).toEqual([
      "auto",
      "light",
      "warm",
      "dark",
    ]);
  });
});
