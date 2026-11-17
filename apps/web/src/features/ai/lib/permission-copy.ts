import type { ChatPermissionAction } from "./chat-types";

export type CamelCase<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : S;

/** Each permission action's wording lives under its camel-cased name. */
export function permissionKey<Field extends "question" | "description" | "approve">(
  action: ChatPermissionAction,
  field: Field,
): `chat.interaction.permission.${CamelCase<ChatPermissionAction>}.${Field}` {
  const name = action.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return `chat.interaction.permission.${name as CamelCase<ChatPermissionAction>}.${field}`;
}
