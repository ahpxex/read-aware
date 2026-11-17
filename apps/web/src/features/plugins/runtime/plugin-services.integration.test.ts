import { expect, test } from "bun:test";

// Existing transport tests replace Worker; execute this real host/Worker chain
// in an isolated process with controlled local state and no native backend.
if (process.env.READAWARE_SERVICE_WORKER_PROOF !== "1") {
  test("real caller and isolated provider Workers preserve service authority and retirement", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, READAWARE_SERVICE_WORKER_PROOF: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, output: out + err }).toMatchObject({ code: 0 });
    expect(out + err).toContain("3 pass");
  }, 30000);
} else {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    },
  });
  const { startPluginWorker } = await import("./plugin-worker-host");
  const { buildPluginContext } = await import("./plugin-context");
  const { pluginCommandsAtom } = await import("../state/plugin-store");
  const { getDefaultStore } = await import("jotai");
  const { hostEnvironment } = await import("../../../platform/host-environment");
  const { spyOn } = await import("bun:test");
  const { AppError } = await import("@read-aware/core");
  const moduleUrl = new URL("../../../../tests/fixtures/plugin-workers/plugin-service-probe.ts", import.meta.url).href;
  const declaration = {
    id: "inspect",
    version: "1.0.0",
    title: "Inspect",
    description: "Inspect fixed authority",
    scope: "book" as const,
    permissions: ["library:read" as const],
    input: { type: "null" as const },
    output: {
      type: "object" as const,
      additionalProperties: false as const,
      properties: {
        activated: { type: "boolean" as const },
        canWrite: { type: "boolean" as const },
        bookId: { type: "string" as const },
        foreignError: { type: "string" as const },
        privateError: { type: "string" as const },
      },
      required: ["activated", "canWrite", "bookId", "foreignError", "privateError"],
    },
  };
  const providerManifest = {
    id: "service-provider",
    name: "Provider",
    version: "1.0.0",
    schemaVersion: 1,
    requires: { services: { plugins: "^1.8.0" } },
    permissions: ["library:write" as const],
    services: [
      declaration,
      { ...declaration, id: "wait", output: { type: "null" as const } },
      { ...declaration, id: "invalid", output: { type: "null" as const } },
    ],
  };
  const callerManifest = {
    id: "service-caller",
    name: "Caller",
    version: "1.0.0",
    schemaVersion: 1,
    requires: {},
    permissions: ["library:read" as const],
  };
  test("caller Worker discovers and invokes fresh provider realm with narrowed host grants", async () => {
    const provider = await startPluginWorker(providerManifest, "1.0.0", [], { moduleUrl });
    provider.promote();
    const caller = await startPluginWorker(callerManifest, "1.0.0", [], {
      moduleUrl,
      bookAccess: { mode: "book", bookId: "book" },
    });
    caller.promote();
    try {
      const commands = getDefaultStore()
        .get(pluginCommandsAtom)
        .filter((command) => command.pluginId === "service-caller");
      expect(await commands.find((command) => command.id === "transaction-denied")!.run()).toMatchObject({
        toast: "plugin/permission-denied",
      });
      const result = await commands.find((command) => command.id === "book")!.run();
      expect(JSON.parse(result?.toast as string)).toEqual({
        activated: false,
        canWrite: false,
        bookId: "book",
        foreignError: "plugin/object-access-denied",
        privateError: "plugin/service-forbidden",
      });
      const denied = await Promise.resolve(commands.find((command) => command.id === "foreign")!.run()).catch(
        (error) => error,
      );
      expect(denied).toMatchObject({ code: "plugin/object-access-denied" });
    } finally {
      await caller.terminate();
      await provider.terminate();
    }
    expect(
      getDefaultStore()
        .get(pluginCommandsAtom)
        .filter((command) => command.pluginId.startsWith("service-")),
    ).toEqual([]);
  }, 15000);
  test("Agent tools discover a real provider and require per-call approval before dispatch", async () => {
    const { buildPluginServiceTools } = await import("../../../../../../packages/agent/src/tools/plugin-service-tools");
    const { pluginServices } = await import("./plugin-services");
    const provider = await startPluginWorker(providerManifest, "1.0.0", [], { moduleUrl });
    provider.promote();
    let approved = false,
      prompts = 0;
    const deps = {
      pluginServices: {
        list: async (
          scope: import("@read-aware/agent").ThreadScope,
          query?: import("@read-aware/core").PluginServiceQuery,
        ) => pluginServices.listForAgent(scope, query),
        call: pluginServices.delegate.bind(pluginServices),
      },
      interactions: {
        request: async (request: { subject?: string }) => {
          prompts++;
          expect(request.subject).toContain('"bookId": "book"');
          expect(request.subject).toContain('"library:read"');
          return { optionId: approved ? "approve" : "decline" };
        },
      },
    } as unknown as import("@read-aware/agent").RuntimeDeps;
    const tools = buildPluginServiceTools({ kind: "book", bookId: "book" }, deps);
    const decode = (result: { content: unknown[] }) => JSON.parse((result.content[0] as { text: string }).text);
    try {
      const page = decode(await tools[0]!.execute("list", { pluginId: "service-provider", id: "inspect" }));
      const request = { service: page.services[0].ref, bookId: "book", input: null };
      expect(decode(await tools[1]!.execute("decline", request))).toEqual({ executed: false, reason: "declined" });
      approved = true;
      const result = decode(await tools[1]!.execute("approve", request));
      expect(result.executed).toBe(true);
      expect(result.receipt.value).toEqual({
        activated: false,
        canWrite: false,
        bookId: "book",
        foreignError: "plugin/object-access-denied",
        privateError: "plugin/service-forbidden",
      });
      const foreign = await tools[1]!.execute("foreign", { ...request, bookId: "other" }).catch((error) => error);
      expect(foreign).toMatchObject({ code: "plugin/object-access-denied" });
      expect(prompts).toBe(2);
    } finally {
      await provider.terminate();
    }
  }, 15000);
  test("caller cancellation and provider stop terminate an in-flight service; malformed results never escape", async () => {
    for (const mode of ["cancel", "stop"] as const) {
      const provider = await startPluginWorker(providerManifest, "1.0.0", [], { moduleUrl });
      provider.promote();
      const caller = buildPluginContext(callerManifest, "1.0.0", [], { mode: "book", bookId: "book" });
      caller.lifecycle.promote();
      const entered = Promise.withResolvers<void>(),
        cancel = new AbortController();
      const original = hostEnvironment.snapshot.bind(hostEnvironment);
      const observe = spyOn(hostEnvironment, "snapshot").mockImplementation(() => {
        entered.resolve();
        return original();
      });
      try {
        const services = (await caller.context.services.plugins.listServices({ pluginId: "service-provider" }))
          .services;
        const invalid = services.find((service) => service.id === "invalid")!.ref;
        const invalidError = await caller.context.services.plugins
          .callService({ service: invalid, bookId: "book", input: null })
          .catch((error) => error);
        expect(invalidError).toMatchObject({ code: "plugin/service-result-invalid" });
        const service = services.find((service) => service.id === "wait")!.ref;
        const pending = caller.context.services.plugins.callService(
          { service, bookId: "book", input: null },
          { signal: cancel.signal },
        );
        // Attach rejection handling without a matcher that waits before we cancel.
        const rejected = pending.then(
          () => null,
          (error) => error,
        );
        await entered.promise;
        if (mode === "cancel") cancel.abort(new AppError("plugin/cancelled", "Cancelled"));
        else await provider.terminate();
        expect(await rejected).toBeInstanceOf(Error);
      } finally {
        observe.mockRestore();
        await provider.terminate();
        caller.lifecycle.stop();
        await caller.lifecycle.drainCleanups();
      }
    }
  }, 15000);
}
