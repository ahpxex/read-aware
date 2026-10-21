import { afterEach, expect, spyOn, test } from "bun:test";
import * as environment from "./environment";
import { pickResourceFiles } from "./pick-resource-files";

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
function bridge(result: (generation: number) => string | null) {
  restore?.();
  const android = spyOn(environment, "isAndroid").mockReturnValue(true);
  restore = () => android.mockRestore();
  let current = 0;
  const requests: boolean[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ReadAwareAndroid: {
        startResourcePick(generation: number, multiple: boolean) {
          current = generation;
          requests.push(multiple);
        },
        takeResourcePickResult() {
          return result(current);
        },
      },
    },
  });
  return requests;
}

test("Android resource picks retain content URIs and provider filenames, and serialize native dialogs", async () => {
  const requests = bridge((generation) => `${generation}\ncontent://provider/document/42\t背景.jpg`);
  const pending = pickResourceFiles({ extensions: ["jpg"], multiple: false });
  await expect(pickResourceFiles({})).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(await pending).toEqual([{ path: "content://provider/document/42", name: "背景.jpg" }]);
  expect(requests).toEqual([false]);
});

test("cancel returns no resources, and a later pick can proceed", async () => {
  bridge((generation) => String(generation));
  expect(await pickResourceFiles({})).toEqual([]);
  expect(await pickResourceFiles({})).toEqual([]);
});

test("stale parked results cannot select a file for a new request", async () => {
  let stale = true;
  bridge((generation) => {
    if (stale) {
      stale = false;
      return `${generation - 1}\ncontent://old\told.png`;
    }
    return `${generation}\ncontent://new\tnew.png`;
  });
  expect(await pickResourceFiles({})).toEqual([{ path: "content://new", name: "new.png" }]);
});

test("retired callers cannot import the result, and native failures are stable errors", async () => {
  bridge((generation) => `${generation}\ncontent://picked\timage.png`);
  const controller = new AbortController();
  const pending = pickResourceFiles({}, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  bridge((generation) => `${generation}\n__ERROR__:native failure`);
  await expect(pickResourceFiles({})).rejects.toMatchObject({ code: "ui/unavailable" });
});
