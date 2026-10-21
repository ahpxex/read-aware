import { afterEach, expect, spyOn, test } from "bun:test";
import { getDefaultStore } from "jotai";
import type { PluginManifest, PluginRuntimeTheme } from "@read-aware/plugin-types";
import { ResourceOwner } from "../../../services/resource-owner";
import * as ipc from "../../../platform/ipc";
import { pluginThemesAtom } from "../state/plugin-store";
import { buildPluginContext } from "./plugin-context";
import { resolveReaderPalette } from "../../settings/lib/reader-theme";
import { describeContext } from "./plugin-worker-host";

const manifest: PluginManifest = {
  id: "background-test",
  name: "Background",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: ["ui:themes"],
  requires: {},
};
const input: PluginRuntimeTheme = {
  id: "picture",
  name: "Picture",
  polarity: "light",
  reader: { palette: { bg: "#fff", text: "#222", selection: "#eee", rule: "#aaa", faint: "#ddd", muted: "#666" } },
  readerBackground: { assetKey: "picture", assetRevision: "a".repeat(32), opacity: 0.25, dim: 0.1 },
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function fixture(permissions = manifest.permissions) {
  const runtime = buildPluginContext({ ...manifest, permissions }, "0.6.7", []);
  cleanups.push(() => runtime.lifecycle.stop());
  return runtime;
}
function images() {
  const invoke = spyOn(ipc, "invoke").mockResolvedValue({ id: "native" });
  const open = spyOn(ResourceOwner.prototype, "importAsset").mockImplementation(async (read) => {
    await read();
    return {
      id: "owned",
      name: "picture.png",
      mimeType: "image/png",
      size: 4,
      source: "asset",
      state: "ready",
      expiresAt: Date.now() + 1000,
    };
  });
  const preview = spyOn(ResourceOwner.prototype, "imagePreview").mockResolvedValue(
    new Blob(["png"], { type: "image/png" }),
  );
  const release = spyOn(ResourceOwner.prototype, "release").mockResolvedValue(undefined);
  const create = spyOn(URL, "createObjectURL").mockImplementation(() => `blob:background-${Math.random()}`);
  const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  cleanups.push(() => {
    for (const mock of [invoke, open, preview, release, create, revoke]) mock.mockRestore();
  });
  return { invoke, preview, release, create, revoke };
}

test("runtime image themes are permission-gated and discoverable through the Worker context", () => {
  expect(fixture([]).context.contributions.themes).toBeUndefined();
  expect(JSON.stringify(describeContext(fixture().context))).toContain("themes");
});

test("owned assets decode before staged publication; replacement and disposal release exact URLs", async () => {
  const mocks = images();
  const runtime = fixture();
  const first = await runtime.context.contributions.themes!.register(input);
  expect(mocks.invoke).toHaveBeenCalledWith("resource_open_plugin_asset", {
    pluginId: manifest.id,
    key: "picture",
    expectedRevision: "a".repeat(32),
  });
  expect(mocks.release).toHaveBeenCalledWith("owned");
  expect(mocks.create).not.toHaveBeenCalled();
  runtime.lifecycle.promote();
  const palette = () => resolveReaderPalette("plugin:background-test:picture", getDefaultStore().get(pluginThemesAtom));
  const oldUrl = palette().background!.url;
  const second = await runtime.context.contributions.themes!.register({
    ...input,
    readerBackground: { ...input.readerBackground!, opacity: 0.8 },
  });
  first.dispose();
  expect(mocks.revoke).toHaveBeenCalledWith(oldUrl);
  expect(palette().background?.opacity).toBe(0.8);
  second.dispose();
  expect(palette().background).toBeUndefined();
  expect(mocks.revoke).toHaveBeenCalledTimes(2);
});

test("invalid parameters and corrupt replacement images preserve the live theme", async () => {
  const mocks = images();
  const runtime = fixture();
  runtime.lifecycle.promote();
  await runtime.context.contributions.themes!.register(input);
  const current = getDefaultStore()
    .get(pluginThemesAtom)
    .find((item) => item.pluginId === manifest.id);
  for (const change of [{ opacity: NaN }, { dim: 2 }, { assetKey: "../other" }, { assetRevision: "stale" }]) {
    await expect(
      runtime.context.contributions.themes!.register({
        ...input,
        readerBackground: { ...input.readerBackground!, ...change },
      }),
    ).rejects.toMatchObject({ code: "plugin/invalid-argument" });
  }
  mocks.preview.mockRejectedValueOnce(new Error("corrupt image"));
  await expect(runtime.context.contributions.themes!.register(input)).rejects.toThrow("corrupt image");
  expect(
    getDefaultStore()
      .get(pluginThemesAtom)
      .find((item) => item.pluginId === manifest.id),
  ).toBe(current);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledTimes(2);
});

test("retirement during decoding prevents late publication", async () => {
  const mocks = images();
  const runtime = fixture();
  runtime.lifecycle.promote();
  const deferred = Promise.withResolvers<Blob>();
  mocks.preview.mockReturnValueOnce(deferred.promise);
  const pending = runtime.context.contributions.themes!.register(input);
  const outcome = pending.then(
    () => null,
    (error: unknown) => error,
  );
  for (let i = 0; i < 20 && !mocks.preview.mock.calls.length; i++) await Promise.resolve();
  runtime.lifecycle.stop();
  deferred.resolve(new Blob(["png"], { type: "image/png" }));
  expect(await outcome).toMatchObject({ code: "plugin/cancelled" });
  await runtime.lifecycle.drainCleanups();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledWith("owned");
});
