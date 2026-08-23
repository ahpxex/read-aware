import { describe, expect, test } from "bun:test";
import type { PluginContext } from "../lib/plugin-types";
import { describeContext } from "./plugin-worker-host";

describe("plugin worker capability bridge", () => {
  test("derives deeply nested domain and contribution methods from the actor view", () => {
    const context = {
      domains: {
        library: {
          queries: { books: { list: () => [] } },
          commands: { books: { importBook: () => null } },
          events: { subscribe: () => ({ dispose() {} }) },
        },
      },
      contributions: {
        contentProviders: { register: () => ({ dispose() {} }) },
      },
      services: {},
    } as unknown as PluginContext;

    expect(describeContext(context)).toMatchObject({
      domains: {
        library: {
          queries: { books: { list: "fn" } },
          commands: { books: { importBook: "fn" } },
          events: { subscribe: "fn" },
        },
      },
      contributions: {
        contentProviders: { register: "fn" },
      },
    });
  });
});
