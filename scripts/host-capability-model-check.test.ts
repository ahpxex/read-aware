import { describe, expect, test } from "bun:test";
import { units } from "../docs/host-capability-model.data";
import { validateModel } from "./host-capability-model-check";

describe("capability ownership audit", () => {
  test("covers every matrix row and runtime catalog entry", () => {
    const result = validateModel();
    expect(result.owners.size).toBe(result.rows.length);
    expect(result.catalog.size).toBe(38);
    expect(result.catalog.get("services.logging")).toBe("S12");
    expect(result.catalog.get("contributions.contextActions")).toBe("C1");
    expect(result.catalog.get("services.resources")).toBe("S4");
    expect(result.catalog.get("services.maintenance")).toBe("S3");
    expect(result.catalog.get("services.diagnostics")).toBe("S3");
    expect(result.catalog.get("services.plugins")).toBe("S10");
    expect(result.catalog.get("domains.memory")).toBe("D6");
  });
  test("rejects missing behavior coverage", () => {
    const copy = structuredClone(units);
    for (const u of copy) u.refs = u.refs.filter(id => id !== "LIB01");
    expect(() => validateModel(copy)).toThrow("Unmodeled row LIB01");
  });
  test("rejects unknown evidence", () => {
    const copy = structuredClone(units);
    copy[0].refs.push("LIB99");
    expect(() => validateModel(copy)).toThrow("Unknown evidence LIB99");
  });
  test("rejects two owners of the same runtime catalog entry", () => {
    const copy = structuredClone(units);
    copy[1].catalog.push("domains.library");
    expect(() => validateModel(copy)).toThrow("Duplicate catalog owner");
  });
  test("rejects omitted runtime catalog entries", () => {
    const copy = structuredClone(units);
    copy[0].catalog = [];
    expect(() => validateModel(copy)).toThrow("Runtime catalog model drift");
  });
  test("requires both actor contracts and acceptance", () => {
    const copy = structuredClone(units);
    copy[0].agent = "";
    expect(() => validateModel(copy)).toThrow("Missing contract");
    copy[0] = { ...units[0], acceptance: "" };
    expect(() => validateModel(copy)).toThrow("Missing contract");
  });
  test("rejects changing a domain into a service", () => {
    const copy = structuredClone(units);
    copy[0].family = "Service";
    expect(() => validateModel(copy)).toThrow("Incorrect semantic family");
  });
});
