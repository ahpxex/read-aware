import { build, type Plugin } from "vite";
import { resolve } from "node:path";
import policy from "../plugin-sandbox-policy.json";

/** A worker has its own response CSP; the owning page's policy is not enough. */
export function pluginSandboxPolicy(verifyBuild = true): Plugin {
  return {
    name: "readaware-plugin-sandbox-policy",
    generateBundle(_options, bundle) {
      if (!verifyBuild) return;
      const prefix = policy.productionAssetPrefix.slice(1);
      const workers = Object.keys(bundle).filter(path => path.startsWith(prefix) && path.endsWith(".js"));
      if (workers.length !== 1) {
        this.error("Expected exactly one plugin sandbox worker in the native CSP asset namespace");
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname !== policy.sourcePath) { next(); return; }
        // Vite's dev import analysis injects @vite/client even into a module
        // worker (dynamic import query helper). That client needs WebSocket
        // and cannot run under the sandbox policy. Serve the actual bundled
        // worker instead, with no HMR client and no weaker development CSP.
        void build({
          configFile: false, root: server.config.root, logLevel: "silent",
          build: { write: false, minify: false, sourcemap: false,
            lib: { entry: resolve(server.config.root, policy.sourcePath.slice(1)), formats: ["es"] },
          },
        }).then(result => {
          if ("on" in result) throw new Error("Unexpected watch build for sandbox worker");
          const output = (Array.isArray(result) ? result[0] : result)?.output;
          if (output?.length !== 1 || output[0]?.type !== "chunk") throw new Error("Sandbox dev build must contain exactly one JavaScript chunk");
          response.setHeader("Content-Security-Policy", policy.contentSecurityPolicy);
          response.setHeader("Content-Type", "text/javascript");
          response.setHeader("Cache-Control", "no-store");
          response.end(output[0].code);
        }).catch(next);
      });
    },
  };
}

export function workerEntryFileName(chunk: { name: string }): string {
  return chunk.name === "plugin-sandbox.worker"
    ? `${policy.productionAssetPrefix.slice(1)}[name]-[hash].js`
    : "assets/[name]-[hash].js";
}
