import { expect, test } from "bun:test";
import { USER_PERMISSION_ACTIONS } from "@read-aware/agent";
import { permissionKey } from "./permission-copy";

const LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"];

test("every permission action is worded in every locale", async () => {
  for (const locale of LOCALES) {
    const json = await Bun.file(new URL(`../../../i18n/locales/${locale}/ai.json`, import.meta.url)).json();
    for (const action of USER_PERMISSION_ACTIONS)
      for (const field of ["question", "description", "approve"] as const) {
        const value = permissionKey(action, field)
          .split(".")
          .reduce<unknown>((node, segment) => (node as Record<string, unknown> | undefined)?.[segment], json);
        expect({
          locale,
          key: permissionKey(action, field),
          present: typeof value === "string" && value.length > 0,
        }).toEqual({
          locale,
          key: permissionKey(action, field),
          present: true,
        });
      }
  }
});

test("action names map to their camel-cased copy", () => {
  expect(permissionKey("generate-book-graph", "question")).toBe(
    "chat.interaction.permission.generateBookGraph.question",
  );
  expect(permissionKey("sync-now", "approve")).toBe("chat.interaction.permission.syncNow.approve");
});
