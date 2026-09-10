import { expect, test } from "bun:test";
import { buildPluginContext } from "./plugin-context";

test("schedule services only enumerate/control their own bindings and stop observing at retirement", async () => {
  const create = (id: string) => buildPluginContext({ id, name: id, version: "1", schemaVersion: 1, requires: {},
    schedules: [{ id: "tick", label: "Tick", everyMinutes: 60 }] }, "0.5.4", []);
  const a = create("schedule-a"), b = create("schedule-b");
  try {
    a.context.services.schedules.bind("tick", () => {}); b.context.services.schedules.bind("tick", () => {});
    a.lifecycle.promote(); b.lifecycle.promote();
    const page = await a.context.services.schedules.list({ pluginId: "schedule-b" } as never);
    expect(page.schedules.map(item => item.pluginId)).toEqual(["schedule-a"]);
    await expect(a.context.services.schedules.control("missing", "run")).rejects.toMatchObject({ code: "ui/unavailable" });
    const seen: number[] = []; a.context.services.schedules.observe({}, value => seen.push(value.total));
    expect(seen).toEqual([1]); a.lifecycle.stop(); b.lifecycle.stop(); await Bun.sleep(0); expect(seen).toEqual([1]);
    expect(() => a.context.services.schedules.control("tick", "pause")).toThrow();
  } finally { a.lifecycle.stop(); b.lifecycle.stop(); }
});
