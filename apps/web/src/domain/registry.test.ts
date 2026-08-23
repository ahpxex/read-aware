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
});
