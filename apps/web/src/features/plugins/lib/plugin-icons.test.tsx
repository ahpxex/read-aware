import { expect, test } from "bun:test";
import { isValidElement } from "react";
import { PencilSimple, PushPin } from "@phosphor-icons/react";
import { PLUGIN_ICON_NAMES, renderPluginIcon } from "./plugin-icons";

test("memory feedback icons resolve to their functional symbols, not the fallback", () => {
  for (const [name, glyph] of [["pencil-simple", PencilSimple], ["push-pin", PushPin]] as const) {
    expect(PLUGIN_ICON_NAMES).toContain(name);
    const element = renderPluginIcon(name);
    expect(isValidElement(element) && element.type).toBe(glyph);
  }
});
