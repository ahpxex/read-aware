import { describe, expect, test } from "bun:test";
import {
  DOMAIN_PERMISSIONS,
  domainGrantsFromPermissions,
} from "./domains";

describe("domain capability catalog", () => {
  test("derives the public permission vocabulary from the domain roster", () => {
    expect(DOMAIN_PERMISSIONS).toEqual([
      "library:read",
      "library:write",
      "reading:read",
      "reading:write",
      "annotations:read",
      "annotations:write",
      "conversations:read",
    ]);
  });

  test("collapses actor permissions to the strongest domain grant", () => {
    expect(
      domainGrantsFromPermissions([
        "library:read",
        "library:write",
        "conversations:read",
        "service:network",
      ]),
    ).toEqual({ library: "write", conversations: "read" });
  });
});
