import { expect, test } from "bun:test";
import { createSystemFontLoader } from "./system-fonts";

test("native family names are filtered, deduplicated and shared without mutable cache aliases", async () => {
  let calls = 0;
  const load = createSystemFontLoader(async () => { calls++; return [" Zeta ", ".Hidden", "", "Arial", "arial", "bad\nname", "x".repeat(121)]; });
  const [a, b] = await Promise.all([load(), load()]);
  expect(calls).toBe(1); expect(a).toEqual(["Arial", "Zeta"]); expect(b).toEqual(a);
  a.push("Injected"); b.splice(0);
  expect(await load()).toEqual(["Arial", "Zeta"]); expect(calls).toBe(1);
});

test("native enumeration failure is not cached as an empty installed set and can retry", async () => {
  let calls = 0;
  const load = createSystemFontLoader(async () => { if (++calls === 1) throw new Error("native failure"); return ["Recovered"]; });
  await expect(load()).rejects.toMatchObject({ code: "settings/font-enumeration-failed", retryable: true });
  expect(await load()).toEqual(["Recovered"]); expect(calls).toBe(2);
});
