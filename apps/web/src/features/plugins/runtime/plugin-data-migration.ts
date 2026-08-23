import type { PluginMigration } from "@read-aware/plugin-types";

/** Decide whether a committed plugin data schema needs executable migration. */
export function planPluginDataMigration(input: {
  storedVersion: number | null;
  targetVersion: number;
  hasMigration: boolean;
}): PluginMigration | null {
  const fromVersion = input.storedVersion ?? 0;
  if (fromVersion === input.targetVersion) return null;
  if (!input.hasMigration) {
    // The first host version that records schema metadata adopts the installed
    // plugin's declaration as its baseline. Subsequent changes are never
    // guessed: they need executable migration in either direction.
    if (input.storedVersion === null) return null;
    throw new Error(
      `plugin data schema changed from ${fromVersion} to ${input.targetVersion} but migrate() is missing`,
    );
  }
  return {
    fromVersion,
    toVersion: input.targetVersion,
    direction: input.targetVersion > fromVersion ? "upgrade" : "downgrade",
  };
}
