import { invoke } from "./ipc";
import { isMobileOS, isTauri } from "./environment";

/** The host's battery reading: `level` is a 0..1 fraction. */
export type BatteryStatus = {
  level: number;
  charging: boolean;
};

/**
 * One battery snapshot for the reader header/footer strips. Android reads
 * `BatteryManager` in the activity, iOS reads `UIDevice` through the ObjC
 * bridge; everywhere else the command returns null — as it does on a device
 * with no battery or an unreadable one.
 */
export async function readBatteryStatus(): Promise<BatteryStatus | null> {
  if (!isTauri() || !isMobileOS()) return null;
  return await invoke<BatteryStatus | null>("battery_status");
}
