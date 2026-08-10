import { beforeEach, describe, expect, test } from "bun:test";

// bun test 没有 DOM——按仓库惯例给 localStorage 一个 Map stub
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

import {
  WHATS_NEW_TTL_MS,
  changelogUrlForLocale,
  dismissWhatsNew,
  reconcileWhatsNew,
} from "./whats-new";

const KEY = "read-aware-whats-new";

describe("whats-new notice", () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
  });

  test("first run records the version silently", () => {
    expect(reconcileWhatsNew("0.3.1", 1000)).toBeNull();
    expect(reconcileWhatsNew("0.3.1", 2000)).toBeNull();
  });

  test("a version change raises the notice and it persists across runs", () => {
    reconcileWhatsNew("0.3.1", 1000);
    expect(reconcileWhatsNew("0.3.2", 2000)).toEqual({ version: "0.3.2" });
    expect(reconcileWhatsNew("0.3.2", 3000)).toEqual({ version: "0.3.2" });
  });

  test("dismissing silences it until the next version", () => {
    reconcileWhatsNew("0.3.1", 1000);
    reconcileWhatsNew("0.3.2", 2000);
    dismissWhatsNew();
    expect(reconcileWhatsNew("0.3.2", 3000)).toBeNull();
    expect(reconcileWhatsNew("0.3.3", 4000)).toEqual({ version: "0.3.3" });
  });

  test("the notice expires on its own after the TTL", () => {
    reconcileWhatsNew("0.3.1", 1000);
    reconcileWhatsNew("0.3.2", 2000);
    expect(reconcileWhatsNew("0.3.2", 2000 + WHATS_NEW_TTL_MS - 1)).toEqual({
      version: "0.3.2",
    });
    expect(reconcileWhatsNew("0.3.2", 2000 + WHATS_NEW_TTL_MS + 1)).toBeNull();
  });

  test("changelog routes follow the app language, falling back to English", () => {
    expect(changelogUrlForLocale("zh-Hans")).toBe("https://readaware.app/zh/changelog");
    expect(changelogUrlForLocale("zh-Hant")).toBe("https://readaware.app/zh/changelog");
    expect(changelogUrlForLocale("ja")).toBe("https://readaware.app/ja/changelog");
    expect(changelogUrlForLocale("en")).toBe("https://readaware.app/changelog");
    expect(changelogUrlForLocale("fr")).toBe("https://readaware.app/changelog");
  });
});
