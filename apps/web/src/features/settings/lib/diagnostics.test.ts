import { expect, spyOn, test } from "bun:test";
import { sendDiagnosticsReport, type DiagnosticsBundle } from "./diagnostics";
import * as scheduler from "../../../platform/sync/sync-scheduler";

test("report submission requires an acknowledged, nonempty bounded receipt", async () => {
  const bundle: DiagnosticsBundle = { generatedAt: "2026-09-11", appVersion: "1", platform: "test", userAgent: "test", language: "en",
    logs: [], projections: { consistent: true, eventsReplayed: 0, drift: [] } };
  const fetch = spyOn(globalThis, "fetch");
  const relay = spyOn(scheduler, "relayBaseUrl").mockReturnValue("https://diagnostics.example");
  try {
    for (const value of [null, {}, { ok: false, reportId: "id" }, { ok: true, reportId: "" }, { ok: true, reportId: " ", }, { ok: true, reportId: "x".repeat(257) }]) {
      fetch.mockResolvedValueOnce(Response.json(value));
      await expect(sendDiagnosticsReport(bundle)).rejects.toMatchObject({ code: "sync/server" });
    }
    fetch.mockResolvedValueOnce(Response.json({ ok: true, reportId: "receipt-1" }));
    expect(await sendDiagnosticsReport(bundle)).toBe("receipt-1");
    const [, options] = fetch.mock.calls.at(-1)!;
    expect(options?.method).toBe("POST");
    expect(JSON.parse(options?.body as string)).toEqual({ appVersion: "1", platform: "test", bundle });
  } finally { fetch.mockRestore(); relay.mockRestore(); }
});
