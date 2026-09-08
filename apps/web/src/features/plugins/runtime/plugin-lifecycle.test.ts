import { describe, expect, test } from "bun:test";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { PluginLifecycleController } from "./plugin-lifecycle";

describe("plugin lifecycle barrier", () => {
  test("shutdown drains asynchronous resource cleanup, including failures already settled", async () => {
    const lifecycle = new PluginLifecycleController([]);
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    lifecycle.stage(() => ({ dispose: () => {
      lifecycle.trackCleanup(Promise.reject(new Error("provider close failed")));
      lifecycle.trackCleanup(pending);
    } }));
    lifecycle.promote(); lifecycle.stop();
    await Promise.resolve();
    let settled = false;
    const draining = lifecycle.drainCleanups().then(() => "ok", error => error).finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    expect(await draining).toBeInstanceOf(AggregateError);
    await lifecycle.drainCleanups();
  });
  test("stopping cancels host operations once with a stable code", () => {
    const lifecycle = new PluginLifecycleController([]);
    let cancellations = 0;
    lifecycle.signal.addEventListener("abort", () => cancellations++);
    lifecycle.cancelOperations();
    lifecycle.stop();
    expect(cancellations).toBe(1);
    expect(lifecycle.signal.reason.code).toBe("plugin/cancelled");
  });
  test("keeps registrations inert until explicit promotion", () => {
    const owned: PluginDisposable[] = [];
    const lifecycle = new PluginLifecycleController(owned);
    let live = 0;

    lifecycle.stage(() => {
      live += 1;
      return { dispose: () => (live -= 1) };
    });

    expect(live).toBe(0);
    expect(lifecycle.phase).toBe("activating");
    lifecycle.promote();
    expect(live).toBe(1);
    expect(lifecycle.phase).toBe("active");
    owned[0]?.dispose();
    expect(live).toBe(0);
  });

  test("allows only migration storage writes before activation", () => {
    const lifecycle = new PluginLifecycleController([]);
    expect(() => lifecycle.assertActive("domain write")).toThrow("activating");
    expect(() => lifecycle.assertStorageWrite("storage write")).toThrow("activating");

    lifecycle.beginMigration();
    expect(() => lifecycle.assertStorageWrite("storage write")).not.toThrow();
    expect(() => lifecycle.assertActive("domain write")).toThrow("migrating");
    lifecycle.finishMigration();
  });

  test("rolls back partial registration promotion", () => {
    const lifecycle = new PluginLifecycleController([]);
    let live = 0;
    lifecycle.stage(() => {
      live += 1;
      return { dispose: () => (live -= 1) };
    });
    lifecycle.stage(() => {
      throw new Error("bad registration");
    });

    expect(() => lifecycle.promote()).toThrow("bad registration");
    expect(live).toBe(0);
    expect(lifecycle.phase).toBe("activating");
  });

  test("stopping rejects new work but drains already accepted durable writes", async () => {
    const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
    let finish!: () => void;
    const write = lifecycle.storageWrite("set", () => new Promise<void>(resolve => { finish = resolve; }));
    lifecycle.stop();
    expect(() => lifecycle.storageWrite("set", async () => {})).toThrow("stopped");
    expect(() => lifecycle.stage(() => ({ dispose() {} }))).toThrow("stopped");
    expect(() => lifecycle.promote()).toThrow("stopped");
    let drained = false;
    const drain = lifecycle.drainStorageWrites().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    finish(); await write; await drain; expect(drained).toBe(true);
  });

  test("migration can be stopped without reopening its write gate", () => {
    const lifecycle = new PluginLifecycleController([]); lifecycle.beginMigration(); lifecycle.stop();
    expect(() => lifecycle.finishMigration()).toThrow("stopped");
    expect(() => lifecycle.assertStorageWrite("set")).toThrow("stopped");
  });

  test("retired registrations leave neither the scope nor an expanding outer cleanup list", () => {
    const owned: PluginDisposable[] = [];
    const lifecycle = new PluginLifecycleController(owned);
    let live = 0;
    for (let i = 0; i < 5000; i++) {
      const registration = lifecycle.stage(() => { live++; return { dispose() { live--; } }; });
      registration.dispose(); registration.dispose();
    }
    expect(lifecycle.registrationCount).toBe(0);
    expect(owned).toHaveLength(1);
    lifecycle.promote();
    for (let i = 0; i < 5000; i++) {
      const registration = lifecycle.stage(() => { live++; return { dispose() { live--; } }; });
      expect(lifecycle.registrationCount).toBe(1);
      registration.dispose(); registration.dispose();
    }
    expect(live).toBe(0);
    expect(lifecycle.registrationCount).toBe(0);
    expect(owned).toHaveLength(1);
    owned[0].dispose();
  });

  test("active factory failure does not retain a registration for a future promotion", () => {
    const lifecycle = new PluginLifecycleController([]);
    lifecycle.promote();
    let attempts = 0;
    expect(() => lifecycle.stage(() => { attempts++; throw new Error("factory failed"); })).toThrow("factory failed");
    expect(lifecycle.registrationCount).toBe(0);
    lifecycle.suspend(); lifecycle.promote();
    expect(attempts).toBe(1);
  });

  test("a failed active registration rolls back its children without disturbing existing resources", () => {
    const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
    let live = 0;
    lifecycle.stage(() => { live++; return { dispose() { live--; } }; });
    expect(() => lifecycle.stage(() => {
      lifecycle.stage(() => { live++; return { dispose() { live--; } }; });
      throw new Error("outer failed");
    })).toThrow("outer failed");
    expect(live).toBe(1); expect(lifecycle.registrationCount).toBe(1);
    expect(lifecycle.phase).toBe("active");
    lifecycle.stop(); expect(live).toBe(0);
  });

  test("a caught child factory failure has its own rollback inside promotion", () => {
    const lifecycle = new PluginLifecycleController([]);
    let live = 0;
    lifecycle.stage(() => {
      expect(() => lifecycle.stage(() => {
        lifecycle.stage(() => { live++; return { dispose() { live--; } }; });
        throw new Error("child failed");
      })).toThrow("child failed");
      live++; return { dispose() { live--; } };
    });
    lifecycle.promote();
    expect(live).toBe(1); expect(lifecycle.registrationCount).toBe(1);
    lifecycle.stop(); expect(live).toBe(0);
  });

  test("disposal failure still retires references and does not prevent closing siblings", () => {
    const owned: PluginDisposable[] = [];
    const lifecycle = new PluginLifecycleController(owned);
    const closed: number[] = [];
    for (let id = 0; id < 3; id++) lifecycle.stage(() => ({ dispose() {
      closed.push(id);
      if (id === 1) throw new Error("close failed");
    } }));
    lifecycle.promote();
    expect(() => lifecycle.stop()).toThrow("Plugin registration disposal failed");
    expect(closed).toEqual([2, 1, 0]);
    expect(lifecycle.registrationCount).toBe(0);
    expect(() => owned[0].dispose()).not.toThrow();
    expect(() => lifecycle.stage(() => ({ dispose() {} }))).toThrow("stopped");
  });

  test("individual failing dispose is idempotent and detached before calling plugin cleanup", () => {
    const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
    let calls = 0;
    const registration = lifecycle.stage(() => ({ dispose() {
      calls++;
      expect(lifecycle.registrationCount).toBe(0);
      registration.dispose();
      throw new Error("close failed");
    } }));
    expect(() => registration.dispose()).toThrow("close failed");
    expect(() => registration.dispose()).not.toThrow();
    lifecycle.stop(); expect(calls).toBe(1);
  });

  test("promotion rollback closes every new resource even when one close throws, then allows retry", () => {
    const lifecycle = new PluginLifecycleController([]);
    let fail = true, live = 0;
    lifecycle.stage(() => { live++; return { dispose() { live--; } }; });
    lifecycle.stage(() => { live++; return { dispose() {
      live--;
      if (fail) {
        expect(() => lifecycle.beginMigration()).toThrow("during registration activation");
        expect(() => lifecycle.stage(() => ({ dispose() {} }))).toThrow("during rollback");
        throw new Error("rollback failed");
      }
    } }; });
    lifecycle.stage(() => { if (fail) throw new Error("activation failed"); return { dispose() {} }; });
    let failure: AggregateError | undefined;
    try { lifecycle.promote(); } catch (error) { failure = error as AggregateError; }
    expect(failure?.errors.map((error: Error) => error.message)).toEqual(["activation failed", "rollback failed"]);
    expect(live).toBe(0); expect(lifecycle.phase).toBe("activating");
    fail = false; lifecycle.promote(); expect(live).toBe(2);
    lifecycle.stop(); expect(live).toBe(0);
  });

  test("reentrant registrations are part of promotion rollback and are not duplicated on retry", () => {
    const lifecycle = new PluginLifecycleController([]);
    let fail = true, live = 0;
    lifecycle.stage(() => {
      lifecycle.stage(() => { live++; return { dispose() { live--; } }; });
      live++;
      return { dispose() { live--; } };
    });
    lifecycle.stage(() => { if (fail) throw new Error("activation failed"); return { dispose() {} }; });
    expect(() => lifecycle.promote()).toThrow("activation failed");
    expect(live).toBe(0); expect(lifecycle.registrationCount).toBe(2);
    fail = false; lifecycle.promote();
    expect(live).toBe(2); expect(lifecycle.registrationCount).toBe(3);
    lifecycle.stop(); expect(live).toBe(0);
  });

  test("disposal or stop during a factory closes the resource returned afterwards", () => {
    const lifecycle = new PluginLifecycleController([]);
    let closed = 0;
    const registration = lifecycle.stage(() => {
      registration.dispose();
      return { dispose() { closed++; } };
    });
    lifecycle.promote();
    expect(closed).toBe(1); expect(lifecycle.registrationCount).toBe(0);
    expect(() => lifecycle.stage(() => {
      lifecycle.stop();
      return { dispose() { closed++; } };
    })).toThrow("stopped during registration");
    expect(closed).toBe(2); expect(lifecycle.registrationCount).toBe(0);
  });

  test("stopping inside promotion cannot reactivate a stopped scope", () => {
    const lifecycle = new PluginLifecycleController([]);
    let closed = 0, laterFactory = false;
    lifecycle.stage(() => { lifecycle.stop(); return { dispose() { closed++; } }; });
    lifecycle.stage(() => { laterFactory = true; return { dispose() {} }; });
    expect(() => lifecycle.promote()).toThrow("stopped during registration");
    expect(closed).toBe(1); expect(laterFactory).toBe(false);
    expect(lifecycle.registrationCount).toBe(0);
    expect(() => lifecycle.promote()).toThrow("stopped");
    expect(() => lifecycle.suspend()).toThrow("stopped");
  });
});
