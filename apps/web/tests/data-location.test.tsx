import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { AppError } from "@read-aware/core";
import { BaseDirectory } from "@tauri-apps/api/path";
import { nativeDataLocation } from "../src/platform/data-location";
import { initI18n } from "../src/i18n";
import { workspace } from "../src/services/workspace";
import { hostMaintenance } from "../src/services/maintenance";
import { DataLocationGroup } from "../src/features/settings/sections/DataLocationGroup";
import { buildPluginContext } from "../src/features/plugins/runtime/plugin-context";

if (process.env.DATA_LOCATION_CASE === "1") {
  function environment() {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
      localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
    const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    const calls: Array<{ command: string; args: unknown }> = [];
    const adapter = { read: async () => "/private/user/ReadAware", reveal: async () => {} };
    Object.assign(dom.window, { __TAURI_INTERNALS__: { invoke: async (command: string, args: unknown) => {
      if (command === "plugin:path|resolve_directory") { calls.push({ command, args }); return adapter.read(); }
      if (command === "plugin:opener|reveal_item_in_dir") { calls.push({ command, args }); return adapter.reveal(); }
      return null; // Unrelated native logging in the host does not operate on files in this test.
    } } });
    return { dom, calls, adapter, close: () => {
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    } };
  }

  test("native data location resolves the app directory and reveals only that path, preserving failure and cancellation", async () => {
    const f = environment();
    try {
      for (const path of ["/private/user/Read Aware", "C:\\Users\\reader\\AppData\\Roaming\\com.readaware.app"]) {
        f.adapter.read = async () => path;
        expect(await nativeDataLocation.read()).toBe(path);
        await nativeDataLocation.reveal();
        expect(f.calls.splice(0)).toEqual([
          { command: "plugin:path|resolve_directory", args: { directory: BaseDirectory.AppData } },
          { command: "plugin:path|resolve_directory", args: { directory: BaseDirectory.AppData } },
          { command: "plugin:opener|reveal_item_in_dir", args: { paths: [path] } },
        ]);
      }
      await expect(nativeDataLocation.reveal(AbortSignal.abort())).rejects.toBeDefined();
      expect(f.calls).toHaveLength(0);
      const gate = Promise.withResolvers<string>(), controller = new AbortController();
      f.adapter.read = () => gate.promise;
      const pending = nativeDataLocation.reveal(controller.signal).catch(error => error);
      controller.abort(); gate.resolve("/late");
      expect(await pending).toBeInstanceOf(Error);
      expect(f.calls.splice(0).map(call => call.command)).toEqual(["plugin:path|resolve_directory"]);

      const failure = { code: "fs/permission", message: "PRIVATE SYSTEM ERROR" };
      f.adapter.read = async () => { throw failure; };
      await expect(nativeDataLocation.read()).rejects.toMatchObject({ code: "fs/permission", cause: failure });
      f.adapter.read = async () => "";
      await expect(nativeDataLocation.reveal()).rejects.toMatchObject({ code: "internal" });
      f.adapter.read = async () => "/private/user/ReadAware";
      f.adapter.reveal = async () => { throw "PRIVATE OPENER ERROR"; };
      await expect(nativeDataLocation.reveal()).rejects.toMatchObject({ code: "ipc/unknown", cause: "PRIVATE OPENER ERROR" });
      f.calls.length = 0;
      Reflect.deleteProperty(f.dom.window, "__TAURI_INTERNALS__");
      expect(nativeDataLocation.supported()).toBe(false);
      await expect(nativeDataLocation.read()).rejects.toMatchObject({ code: "ui/unavailable" });
      expect(f.calls).toHaveLength(0);
    } finally { f.close(); }
  });

  test("the real settings group displays paths only to the user, actor navigation never clicks Reveal, and retirement blocks late navigation", async () => {
    const f = environment(), gate = Promise.withResolvers<void>();
    const navigate = spyOn(workspace, "navigate").mockResolvedValue({ status: "completed" } as never);
    const actor = buildPluginContext({ id: "data-location-test", name: "Data location", version: "1", schemaVersion: 1,
      requires: { services: { maintenance: "^1.4.0" } }, permissions: [] }, "1", []);
    actor.lifecycle.promote();
    const root = createRoot(f.dom.window.document.getElementById("root")!);
    try {
      await initI18n("en");
      await act(async () => { root.render(<StrictMode><ToastProvider><DataLocationGroup /></ToastProvider></StrictMode>); });
      expect(f.dom.window.document.body.textContent).toContain("/private/user/ReadAware");
      const result = await actor.context.services.maintenance.openSettings("data-location");
      expect(result).toEqual({ status: "opened", surface: "data-location" });
      expect(f.dom.window.document.activeElement?.getAttribute("aria-label")).toBe("Data location");
      expect(f.calls.every(call => call.command === "plugin:path|resolve_directory")).toBe(true);
      expect(Object.keys(actor.context.services.maintenance)).not.toContain("readDataDirectory");
      expect(Object.keys(actor.context.services.maintenance)).not.toContain("revealDataDirectory");

      f.adapter.reveal = () => gate.promise;
      const button = f.dom.window.document.querySelector("button")!;
      await act(async () => { button.click(); button.click(); await Bun.sleep(0); });
      expect(button.disabled).toBe(true);
      expect(f.calls.filter(call => call.command === "plugin:opener|reveal_item_in_dir")).toHaveLength(1);
      await act(async () => { gate.resolve(); await Bun.sleep(0); });
      expect(button.disabled).toBe(false);
      f.adapter.reveal = async () => { throw "PRIVATE OPENER FAILURE"; };
      await act(async () => { button.click(); await Bun.sleep(0); });
      expect(f.dom.window.document.body.textContent).toContain("Could not reveal the data directory.");
      expect(f.dom.window.document.body.textContent).not.toContain("PRIVATE OPENER FAILURE");
      expect(button.disabled).toBe(false);

      const navigation = Promise.withResolvers<never>();
      navigate.mockImplementation(() => navigation.promise);
      const pending = actor.context.services.maintenance.openSettings("data-location").catch(error => error);
      actor.lifecycle.stop(); navigation.resolve({ status: "completed" } as never);
      expect(await pending).toBeInstanceOf(Error);
      expect(() => actor.context.services.maintenance.openSettings("data-location")).toThrow();
    } finally {
      actor.lifecycle.stop(); await act(async () => { root.unmount(); });
      navigate.mockResolvedValue({ status: "completed" } as never);
      await expect(hostMaintenance.openSettings("data-location")).rejects.toMatchObject({ code: "ui/unavailable" });
      navigate.mockRestore();
      f.close();
    }
  });

  test("directory read failures clear the path, offer only honest retries and do not deliver old mount results", async () => {
    const f = environment();
    const root = createRoot(f.dom.window.document.getElementById("root")!);
    try {
      await initI18n("en");
      f.adapter.read = async () => { throw new AppError("ipc/unknown", "PRIVATE READ ERROR", { retryable: true }); };
      const render = (key: string) => root.render(<ToastProvider><DataLocationGroup key={key} /></ToastProvider>);
      await act(async () => { render("first"); });
      expect(f.dom.window.document.querySelector("[role=alert]")).not.toBeNull();
      expect(f.dom.window.document.body.textContent).not.toContain("PRIVATE READ ERROR");
      expect(f.dom.window.document.body.textContent).not.toContain("/private/user");
      const retry = [...f.dom.window.document.querySelectorAll("button")].find(button => button.textContent?.includes("Try again"))!;
      expect(retry).toBeDefined();
      f.adapter.read = async () => "/recovered";
      await act(async () => { retry.click(); });
      expect(f.dom.window.document.body.textContent).toContain("/recovered");
      const old = Promise.withResolvers<string>();
      f.adapter.read = () => old.promise;
      await act(async () => { render("old"); });
      f.adapter.read = async () => "/new-mount";
      await act(async () => { render("new"); old.resolve("/old-mount"); });
      expect(f.dom.window.document.body.textContent).toContain("/new-mount");
      expect(f.dom.window.document.body.textContent).not.toContain("/old-mount");
      f.adapter.read = async () => { throw new AppError("fs/permission", "PRIVATE DENIED"); };
      await act(async () => { render("denied"); });
      expect(f.dom.window.document.body.textContent).not.toContain("/new-mount");
      expect(f.dom.window.document.body.textContent).not.toContain("Try again");
      expect(f.dom.window.document.querySelector("button")!.disabled).toBe(true);
    } finally { await act(async () => { root.unmount(); }); f.close(); }
  });
} else {
  test("isolated data location platform and mounted UI contracts", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, DATA_LOCATION_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("3 pass");
  }, 30_000);
}
