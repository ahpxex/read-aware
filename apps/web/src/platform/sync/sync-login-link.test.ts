import { describe, expect, test } from "bun:test";
import { parseSyncLoginUrl } from "./sync-login-link";

describe("parseSyncLoginUrl", () => {
  test("extracts the token from a sign-in link", () => {
    expect(parseSyncLoginUrl("readaware://sync/login/abc123_-XY")).toBe("abc123_-XY");
  });

  test("tolerates surrounding whitespace and scheme case", () => {
    expect(parseSyncLoginUrl("  READAWARE://sync/login/tok  ")).toBe("tok");
  });

  test("stops at query and fragment delimiters", () => {
    expect(parseSyncLoginUrl("readaware://sync/login/tok?utm=x")).toBe("tok");
    expect(parseSyncLoginUrl("readaware://sync/login/tok#frag")).toBe("tok");
    expect(parseSyncLoginUrl("readaware://sync/login/tok/extra")).toBe("tok");
  });

  test("decodes percent-escapes, passing malformed ones through", () => {
    expect(parseSyncLoginUrl("readaware://sync/login/a%2Bb")).toBe("a+b");
    expect(parseSyncLoginUrl("readaware://sync/login/a%ZZb")).toBe("a%ZZb");
  });

  test("rejects everything else", () => {
    expect(parseSyncLoginUrl("readaware://sync/login/")).toBeNull();
    expect(parseSyncLoginUrl("readaware://other/path")).toBeNull();
    expect(parseSyncLoginUrl("https://readaware.app/sync/login#tok")).toBeNull();
    expect(parseSyncLoginUrl("")).toBeNull();
  });
});
