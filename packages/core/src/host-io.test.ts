import { expect, test } from "bun:test";
import { normalizeClipboardText, normalizeExternalUrl, normalizeHostExport, normalizePluginDirectoryQuery } from "./host-io";

test("external links cannot acquire local schemes or embedded credentials", () => {
  expect(normalizeExternalUrl("https://example.com/path?q=reading")).toBe("https://example.com/path?q=reading");
  for (const value of ["file:///etc/passwd", "javascript:alert(1)", "data:text/plain,a", "https://user:secret@example.com", "https://example.com/\n", "readaware://settings", "https://"]) {
    expect(() => normalizeExternalUrl(value)).toThrow();
  }
});
test("host output is bounded and accepted bytes are detached from caller mutation", () => {
  const bytes = new Uint8Array([0, 255]);
  const file = normalizeHostExport({ filename: "report.bin", content: bytes }); bytes[0] = 42;
  expect(file.content).toEqual(new Uint8Array([0, 255]));
  expect(() => normalizeHostExport({ filename: "a", content: {}, path: "/tmp/x" } as never)).toThrow();
  expect(() => normalizeHostExport({ filename: "a", content: "a", mimeType: "text/plain\r\n" })).toThrow();
  expect(() => normalizeClipboardText("x".repeat(1_000_001))).toThrow();
  expect(normalizeClipboardText("")).toBe("");
  expect(normalizePluginDirectoryQuery({ search: " Desk ", limit: 1 })).toEqual({ search: "desk", offset: 0, limit: 1 });
  for (const input of [{ limit: 101 }, { offset: -1 }, { secret: true }, []]) expect(() => normalizePluginDirectoryQuery(input as never)).toThrow();
});
