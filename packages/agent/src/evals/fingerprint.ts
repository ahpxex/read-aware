import { createHash } from "node:crypto";
import type { EvalScenario, EvalSuite, JsonValue } from "./types";

export function sha256(parts: Iterable<string | Uint8Array>): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function fingerprintJson(value: JsonValue): string {
  return sha256([JSON.stringify(value)]);
}

export function fingerprintSuite<TScenario extends EvalScenario<unknown>>(
  suite: EvalSuite<TScenario>,
  metadata?: JsonValue,
): string {
  return sha256([
    suite.id,
    suite.code,
    suite.description,
    JSON.stringify(metadata ?? null),
    ...suite.scenarios.flatMap((scenario) => [
      scenario.id,
      scenario.description,
      JSON.stringify(scenario.tags ?? []),
      JSON.stringify(scenario.input),
      scenario.evaluate.toString(),
    ]),
  ]);
}
