import { describe, expect, test } from "bun:test";
import {
  DOMAIN_REGISTRY,
  createActorDomainView,
  createDomainApi,
} from "./registry";

describe("domain registry", () => {
  test("is the single roster used to construct the full actor API", () => {
    const api = createDomainApi("user");

    expect(Object.keys(api)).toEqual(Object.keys(DOMAIN_REGISTRY));
    for (const domain of Object.values(api)) {
      expect(domain.queries).toBeDefined();
      expect(domain.commands).toBeDefined();
      expect(domain.events).toBeDefined();
    }
  });

  test("resolves read and write grants without leaking other domains", () => {
    const view = createActorDomainView("plugin:test", {
      library: "read",
      annotations: "write",
    });

    expect(Object.keys(view)).toEqual(["library", "annotations"]);
    expect(view.library?.queries).toBeDefined();
    expect(view.library?.events).toBeDefined();
    expect(view.library?.commands).toBeUndefined();
    expect(view.annotations?.queries).toBeDefined();
    expect(view.annotations?.commands).toBeDefined();
    expect(view.reading).toBeUndefined();
    expect(view.conversations).toBeUndefined();
  });

  test("keeps library and reading event ownership separate", () => {
    expect(DOMAIN_REGISTRY.library.events).toContain("book.imported");
    expect(DOMAIN_REGISTRY.library.events).not.toContain("book.progressed");
    expect(DOMAIN_REGISTRY.reading.events).toContain("book.progressed");
    expect(DOMAIN_REGISTRY.reading.events).not.toContain("book.imported");
  });
  test("memory feedback requires write while inspect is read-only", () => {
    const denied = createActorDomainView("plugin:test", { library: "read" });
    expect(denied.memory).toBeUndefined();
    const granted = createActorDomainView("plugin:test", { memory: "read" });
    expect(Object.keys(granted.memory!.queries)).toEqual(["search", "bookGraph", "inspect", "classification", "listGraphTasks", "getGraphTask"]);
    expect(granted.memory!.commands).toBeUndefined();
    expect(Object.keys(createActorDomainView("plugin:test", { memory: "write" }).memory!.commands!)).toEqual(["mutate", "classify", "startGraphTask", "cancelGraphTask", "retryGraphTask"]);
  });
});
