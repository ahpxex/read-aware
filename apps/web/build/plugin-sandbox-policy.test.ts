import { expect, test } from "bun:test";
import { build, createServer } from "vite";
import { fileURLToPath } from "node:url";
import policy from "../plugin-sandbox-policy.json";
import { pluginSandboxPolicy, workerEntryFileName } from "./plugin-sandbox-policy";

test("sandbox worker build output has the native policy namespace", () => {
  expect(workerEntryFileName({ name: "plugin-sandbox.worker" })).toBe(
    `${policy.productionAssetPrefix.slice(1)}[name]-[hash].js`,
  );
  expect(workerEntryFileName({ name: "reader" })).toBe("assets/[name]-[hash].js");
});

test("product builds fail rather than silently omit or duplicate worker protection", async () => {
  for (const count of [0, 2]) {
    await expect(build({
      configFile: false,
      logLevel: "silent",
      plugins: [{
        name: "policy-build-fixture",
        resolveId(id) { if (id === "virtual:policy-test") return id; },
        load(id) { if (id === "virtual:policy-test") return "export const value = 1;"; },
        buildStart() {
          for (let i = 0; i < count; i++) this.emitFile({ type: "asset",
            fileName: `${policy.productionAssetPrefix.slice(1)}test-${i}.js`, source: "/* fixture */" });
        },
      }, pluginSandboxPolicy()],
      build: { write: false, rollupOptions: { input: "virtual:policy-test" } },
    })).rejects.toThrow("Expected exactly one plugin sandbox worker");
  }
});

test("Vite serves the same worker CSP without restricting app responses", async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    plugins: [pluginSandboxPolicy()],
    server: { host: "127.0.0.1", port: 0, preTransformRequests: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Missing local Vite address");
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}${policy.sourcePath}?worker_file&type=module`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(policy.contentSecurityPolicy);
    const source = await response.text();
    expect(source).toContain("PluginStorageMirror");
    const app = await fetch(`${base}/plugin-sandbox-policy.json`);
    expect(app.status).toBe(200);
    expect(app.headers.get("content-security-policy")).toBeNull();
  } finally {
    await server.close();
  }
});
