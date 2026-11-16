import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "../../../i18n";
import type { PluginFormView } from "../lib/plugin-types";
import { PluginFormViewBody } from "./PluginFormViewBody";

type Secrets = NonNullable<PluginFormView["secrets"]>;

function formWith(secrets: Secrets): PluginFormView {
  return {
    kind: "form",
    submitMode: "change",
    fields: [{ kind: "secret", id: "apiKey", label: "API key" }],
    onSubmit: () => undefined,
    secrets,
  };
}

async function mount(view: PluginFormView) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => {
    root.render(<PluginFormViewBody view={view} busy={false} onResult={async () => undefined} />);
  });
  const settle = () => act(async () => {});
  return {
    dom,
    settle,
    text: () => dom.window.document.body.textContent ?? "",
    input: () => dom.window.document.querySelector("input[type=password]") as HTMLInputElement,
    async unmount() {
      await act(async () => root.unmount());
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

async function type(view: Awaited<ReturnType<typeof mount>>, value: string) {
  const input = view.input();
  const setter = Object.getOwnPropertyDescriptor(view.dom.window.HTMLInputElement.prototype, "value")!.set!;
  // React's change detection under jsdom is the IE-era polyfill, which
  // notices value changes on keyup (as in plugin-list-search.test.tsx).
  await act(async () => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new view.dom.window.KeyboardEvent("keyup", { key: value.at(-1) ?? "", bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new view.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await view.settle();
}

test("a secret store that cannot be read says so instead of showing the key as unset", async () => {
  await initI18n("en");
  const view = await mount(
    formWith({
      has: () => {
        // A plugin-authored adapter may throw synchronously, not only reject.
        throw new Error("keychain locked");
      },
      set: () => undefined,
      remove: () => undefined,
    }),
  );
  try {
    await view.settle();
    expect(view.text()).toContain("Couldn't check the saved key.");
  } finally {
    await view.unmount();
  }
});

test("a failed save reports the failure and keeps the draft for a retry", async () => {
  await initI18n("en");
  let attempts = 0;
  const view = await mount(
    formWith({
      has: async () => false,
      set: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("keychain locked");
      },
      remove: async () => undefined,
    }),
  );
  try {
    await type(view, "sk-123");
    expect(view.text()).toContain("Couldn't save the key.");
    expect(view.input().value).toBe("sk-123");

    // The retry succeeds: the failure clears and the field shows the saved state.
    await act(async () => {
      view.input().dispatchEvent(new view.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await view.settle();
    expect(view.text()).not.toContain("Couldn't save the key.");
    expect(view.input().value).toBe("");
    expect(view.input().placeholder).toBe("Saved — enter a new value to replace");
  } finally {
    await view.unmount();
  }
});

test("a failed clear reports the failure and keeps the key shown as saved", async () => {
  await initI18n("en");
  const view = await mount(
    formWith({
      has: async () => true,
      set: async () => undefined,
      remove: async () => {
        throw new Error("keychain locked");
      },
    }),
  );
  try {
    await view.settle();
    const clear = [...view.dom.window.document.querySelectorAll("button")].find((b) => b.textContent === "Clear");
    expect(clear).toBeDefined();
    await act(async () => {
      clear!.dispatchEvent(new view.dom.window.MouseEvent("click", { bubbles: true }));
    });
    await view.settle();
    expect(view.text()).toContain("Couldn't clear the key.");
    expect(view.input().placeholder).toBe("Saved — enter a new value to replace");
  } finally {
    await view.unmount();
  }
});
