import { useAtomValue } from "jotai";
import { contextActionsAtom } from "../state/plugin-store";
import { contextActionItems } from "../lib/context-action-items";
import type { ContextActionInput } from "../lib/plugin-types";

export function usePluginContextItems(input: ContextActionInput) {
  return contextActionItems(useAtomValue(contextActionsAtom), input);
}
