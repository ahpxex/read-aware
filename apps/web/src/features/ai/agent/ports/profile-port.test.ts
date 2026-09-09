import { expect, spyOn, test } from "bun:test";
import { localKV } from "../../../../platform/local-store";
import { createProfilePort } from "./profile-port";

test("profile writes await persistence and propagate failures", async () => {
  let reject!: (error: Error) => void;
  const write = spyOn(localKV, "setItemAsync").mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  try {
    let settled = false;
    const pending = createProfilePort().putProfileSummary("profile draft");
    void pending.then(() => { settled = true; }, () => { settled = true; });
    expect(write).toHaveBeenCalledWith("read-aware-agent-profile", "profile draft");
    expect(settled).toBe(false);
    reject(new Error("persistence rejected"));
    await expect(pending).rejects.toThrow("persistence rejected");
  } finally {
    write.mockRestore();
  }
});
