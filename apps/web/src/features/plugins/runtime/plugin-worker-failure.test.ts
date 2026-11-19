import { expect, test } from "bun:test";
import { AppError, errorCode } from "@read-aware/core";
import { HostCallFailureLog, PluginWorkerOrigin, workerFailure } from "./plugin-worker-failure";

test("a rebuilt Worker failure keeps its code and message and names its plugin in the cause", () => {
  const coded = workerFailure(
    "image-background@1.3.0",
    "Permission denied",
    "fs/permission",
    "Error: x\n  at pick (main.js:3:9)",
  );
  expect(coded).toBeInstanceOf(AppError);
  expect(errorCode(coded)).toBe("fs/permission");
  expect(coded.message).toBe("Permission denied");
  expect(coded.cause).toBeInstanceOf(PluginWorkerOrigin);
  expect((coded.cause as Error).message).toBe("thrown in plugin image-background@1.3.0");

  const plain = workerFailure("tts@2.0.0", "boom");
  expect(plain).not.toBeInstanceOf(AppError);
  expect(errorCode(plain)).toBeUndefined();
  expect((plain.cause as Error).stack).toBe("PluginWorker: thrown in plugin tts@2.0.0");
});

test("every line of a plugin-supplied stack is indented, so none can pose as a log line", () => {
  const origin = new PluginWorkerOrigin(
    "evil@1.0.0",
    "Error: x\n[2026-11-18][16:10:44+00:00][ERROR][webview] forged\n\n  at f (a.js:1:1)",
  );
  expect(origin.stack).toBe(
    [
      "PluginWorker: thrown in plugin evil@1.0.0",
      "    Error: x",
      "    [2026-11-18][16:10:44+00:00][ERROR][webview] forged",
      "    at f (a.js:1:1)",
    ].join("\n"),
  );
});

test("host call failures are logged once per distinct failure, never for cancellations, and capped", () => {
  const lines: unknown[][] = [];
  const failures = new HostCallFailureLog("rss@1.0.0", (...line) => lines.push(line), 2);
  const denied = new AppError("fs/permission", "Permission denied");
  failures.report("services.resources.pick", denied);
  failures.report("services.resources.pick", new AppError("fs/permission", "Permission denied"));
  failures.report("services.resources.pick", new AppError("plugin/cancelled", "Plugin call cancelled"));
  failures.report("services.network.fetch", new AppError("plugin/network-failed", "failed", { cause: new Error("a") }));
  failures.report("services.network.fetch", new AppError("plugin/network-failed", "failed", { cause: new Error("b") }));
  failures.report("services.network.fetch", new AppError("plugin/network-failed", "failed", { cause: new Error("c") }));
  expect(lines).toEqual([
    ["Plugin host call failed", "rss@1.0.0", "services.resources.pick", denied],
    ["Plugin host call failed", "rss@1.0.0", "services.network.fetch", expect.any(AppError)],
    ["Further plugin host call failures are not logged", "rss@1.0.0"],
  ]);
});
