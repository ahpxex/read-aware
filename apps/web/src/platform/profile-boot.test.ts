import { expect, spyOn, test } from "bun:test";
import * as ipc from "./ipc";
import * as environment from "./environment";
import * as interim from "./interim-projections";
import * as secrets from "./secret-store";
import * as genesis from "./event-genesis";
import * as profile from "../domain/user-profile";
import { hydrateLocalStore, localKV } from "./local-store";

test("boot retires the summary mirror and attempts native initialization after legacy imports", async () => {
  const order: string[] = [];
  const mocks = [
    spyOn(environment, "isTauri").mockReturnValue(true),
    spyOn(ipc, "invoke").mockImplementation(async <T>(command: string): Promise<T> => {
      expect(command).toBe("load_kv_all");
      return { "read-aware-migrated-v1": "1", "read-aware-migrated-memories-v1": "1", [profile.LEGACY_PROFILE_KEY]: "Legacy" } as T;
    }),
    spyOn(interim, "hydrateInterimProjections").mockImplementation(async () => { order.push("interim"); }),
    spyOn(secrets, "hydrateSecrets").mockImplementation(async () => { order.push("secrets"); }),
    spyOn(profile, "initializeUserProfile").mockImplementation(async () => {
      expect(localKV.getItem(profile.LEGACY_PROFILE_KEY)).toBeNull();
      order.push("profile");
    }),
    spyOn(genesis, "reconcileGenesisEvents").mockImplementation(async () => { order.push("genesis"); }),
  ];
  try {
    await hydrateLocalStore();
    expect(order).toEqual(["interim", "secrets", "profile", "genesis"]);
    expect(localKV.getItem(profile.LEGACY_PROFILE_KEY)).toBeNull();
    await hydrateLocalStore();
    expect(order).toHaveLength(4);
  } finally { for (const mock of mocks) mock.mockRestore(); }
});
