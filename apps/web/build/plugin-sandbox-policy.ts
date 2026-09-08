import type { Plugin } from "vite";
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
        if (pathname === policy.sourcePath) {
          response.setHeader("Content-Security-Policy", policy.contentSecurityPolicy);
        }
        next();
      });
    },
  };
}

export function workerEntryFileName(chunk: { name: string }): string {
  return chunk.name === "plugin-sandbox.worker"
    ? `${policy.productionAssetPrefix.slice(1)}[name]-[hash].js`
    : "assets/[name]-[hash].js";
}
