import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { AppError, type HostCommandReceipt } from "@read-aware/core";
import { initI18n } from "../../../i18n";
import type { CommandItem } from "../lib/build-commands";
import { useCommandExecution, type NativeCommandExecutor } from "./useCommandExecution";
import { LocalWriteFailureToasts } from "../../../components/LocalWriteFailureToasts";
import { emitAppEvent } from "../../../platform/app-events";

if (process.env.COMMAND_EXECUTION_CASE === "1") {
test("palette waits, isolates frames, reports truthful failures and cancels explicit dismissal", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const item: CommandItem = { id: "book-item", title: "Book", kind: "book", group: "books", icon: null,
    hostCommand: { id: "open-book", args: { bookId: "book" } } };
  const pending: { signal: AbortSignal; resolve(value: HostCommandReceipt): void; reject(error: unknown): void }[] = [];
  const execute: NativeCommandExecutor = (_request, signal) => new Promise((resolve, reject) => { pending.push({ signal, resolve, reject }); });
  let api!: ReturnType<typeof useCommandExecution>, closed = 0;
  const onClose = () => { closed++; };
  function Harness({ open }: { open: boolean }) { api = useCommandExecution(open, onClose, execute); return null; }
  const render = async (open: boolean) => { await act(async () => { root.render(<ToastProvider><LocalWriteFailureToasts /><Harness open={open} /></ToastProvider>); }); };
  const completed: HostCommandReceipt = { commandId: "open-book", status: "completed", completed: ["reading"] };
  try {
    await initI18n("en"); await render(true);
    let run!: Promise<void>;
    await act(async () => { run = api.run(item); });
    expect(api.busy).toBe(true); expect(closed).toBe(0);
    await act(async () => { await api.run(item); }); expect(pending).toHaveLength(1);
    await act(async () => { pending.shift()!.resolve(completed); await run; });
    expect(closed).toBe(1); expect(api.busy).toBe(false);

    await act(async () => { run = api.run(item); });
    const old = pending.shift()!;
    // Navigation itself closes the palette before its component receipt arrives.
    await render(false); expect(old.signal.aborted).toBe(false);
    await render(true);
    await act(async () => { old.resolve(completed); await run; });
    expect(closed).toBe(1);

    await act(async () => { run = api.run(item); });
    await act(async () => {
      emitAppEvent("local-write-failed", { kind: "kv", code: "db/locked", owner: "caller" });
      pending.shift()!.reject(new AppError("db/locked", "private raw failure")); await run;
    });
    expect(closed).toBe(1); expect(api.busy).toBe(false);
    expect(dom.window.document.body.textContent).not.toContain("private raw failure");
    expect(dom.window.document.querySelector('[role="status"]')?.textContent).toBeTruthy();
    expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(1);
    await act(async () => { emitAppEvent("local-write-failed", { kind: "kv", code: "db/locked" }); });
    expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(2);

    await act(async () => { run = api.run(item); });
    await act(async () => { pending.shift()!.resolve({ commandId: "layout-list", status: "partial", completed: ["settings"], errorCode: "ui/superseded" }); await run; });
    expect(closed).toBe(1); expect(dom.window.document.body.textContent).toContain("Setting saved");

    await act(async () => { run = api.run(item); });
    const dismissed = pending.shift()!;
    await act(async () => { api.dismiss(); }); expect(dismissed.signal.aborted).toBe(true); expect(closed).toBe(2);
    await act(async () => { dismissed.resolve(completed); await run; }); expect(closed).toBe(2);

    const callbacks: { signal: AbortSignal; resolve(): void; reject(error: unknown): void }[] = [];
    const asyncItem: CommandItem = { id: "reading-ai", title: "Explain", kind: "action", group: "goto", icon: null,
      perform: signal => new Promise<void>((resolve, reject) => { callbacks.push({ signal: signal!, resolve, reject }); }) };
    await render(false); await render(true);
    await act(async () => { run = api.run(asyncItem); });
    expect(api.busy).toBe(true); expect(closed).toBe(2);
    await act(async () => { callbacks.shift()!.reject(new AppError("ui/unavailable", "private action failure")); await run; });
    expect(api.busy).toBe(false); expect(closed).toBe(2);
    expect(dom.window.document.body.textContent).not.toContain("private action failure");
    await act(async () => { run = api.run(asyncItem); });
    const oldCallback = callbacks.shift()!;
    await render(false); await render(true);
    expect(oldCallback.signal.aborted).toBe(false);
    await act(async () => { oldCallback.resolve(); await run; }); expect(closed).toBe(2);
    await act(async () => { run = api.run(asyncItem); });
    const cancelledCallback = callbacks.shift()!;
    await act(async () => { api.dismiss(); }); expect(cancelledCallback.signal.aborted).toBe(true);
    await act(async () => { cancelledCallback.resolve(); await run; }); expect(closed).toBe(3);

    await render(false); await render(true);
    await act(async () => { run = api.run(item); });
    const unmounted = pending.shift()!;
    await act(async () => { root.unmount(); }); expect(unmounted.signal.aborted).toBe(true);
    unmounted.resolve(completed); await run; expect(closed).toBe(3);
  } finally {
    for (const task of pending.splice(0)) task.resolve(completed);
    await act(async () => { root.unmount(); }); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
} else {
  test("isolated native command execution lifecycle", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, COMMAND_EXECUTION_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
