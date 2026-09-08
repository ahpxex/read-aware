import { expect, test } from "bun:test";
import { PluginStorageMirror } from "./plugin-storage-mirror";

test("a host rollback cannot clobber a newer pending Worker write", () => {
  const mirror = new PluginStorageMirror(); mirror.replace({ key: "original" });
  const first = mirror.begin("key", "first"); const second = mirror.begin("key", "second");
  mirror.replace({ key: "original" }); mirror.settle(first);
  expect(mirror.get("key")).toBe("second");
  mirror.replace({ key: "second" }); mirror.settle(second);
  expect(mirror.get("key")).toBe("second");
});
test("failed writes rebase on the authoritative host snapshot", () => {
  const mirror = new PluginStorageMirror(); mirror.replace({ key: "original" });
  const write = mirror.begin("key", "next"); mirror.replace({ key: "external" });
  expect(mirror.get("key")).toBe("next"); mirror.settle(write);
  expect(mirror.get("key")).toBe("external");
});
test("pending deletion and host deletion are distinct", () => {
  const mirror = new PluginStorageMirror(); mirror.replace({ key: "original" });
  const remove = mirror.begin("key", null); expect(mirror.get("key")).toBeUndefined();
  mirror.settle(remove); expect(mirror.get("key")).toBe("original");
  mirror.replace({}); expect(mirror.get("key")).toBeUndefined();
});
