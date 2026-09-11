import { expect, test } from "bun:test";
import { saveResourceFile } from "./resource-save";

test("cancelled dialogs do not write and native write failures are not hidden", async () => {
  let writes = 0;
  expect(await saveResourceFile(async () => null, async () => { writes++; })).toBe(false);
  expect(writes).toBe(0);
  await expect(saveResourceFile(async () => "target", async () => { throw Error("Disk full"); })).rejects.toThrow("Disk full");
  let opened = false;
  await expect(saveResourceFile(async () => { opened = true; return "target"; }, async () => {}, AbortSignal.abort())).rejects.toBeDefined();
  expect(opened).toBe(false);
});
