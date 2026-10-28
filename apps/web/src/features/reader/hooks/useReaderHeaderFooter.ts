import { useEffect, useState } from "react";
import { isMobileOS } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { readBatteryStatus, type BatteryStatus } from "../../../platform/battery";

const log = createLogger("reader-header-footer");

/** The battery poll cadence — shared with the minute-aligned clock tick. */
const BATTERY_POLL_MS = 60_000;

function msToNextMinute(): number {
  const now = Date.now();
  return 60_000 - (now % 60_000);
}

/**
 * Clock and battery state for the reader header/footer strips. One timer,
 * armed to the next minute boundary, drives both the clock and the minute-
 * spaced battery poll; returning to a visible tab refreshes immediately.
 * Nothing runs while neither item is placed in a strip.
 */
export function useReaderHeaderFooter({ time, battery }: { time: boolean; battery: boolean }): {
  now: number;
  battery: BatteryStatus | null;
} {
  const [now, setNow] = useState(() => Date.now());
  const [batteryStatus, setBatteryStatus] = useState<BatteryStatus | null>(null);
  const wantBattery = battery && isMobileOS();
  const active = time || wantBattery;

  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const refreshBattery = () => {
      if (!wantBattery) return;
      void readBatteryStatus().then(
        (status) => setBatteryStatus(status),
        (error: unknown) => {
          // A decorative status strip has no error surface; the item just
          // renders empty until the next poll succeeds.
          log.warn("Battery status read failed", error);
          setBatteryStatus(null);
        },
      );
    };
    const tick = () => {
      // A visibility-driven refresh may run while a timeout is still pending —
      // drop it before re-arming so timers never stack.
      window.clearTimeout(timer);
      setNow(Date.now());
      refreshBattery();
      timer = window.setTimeout(tick, time ? msToNextMinute() : BATTERY_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, time, wantBattery]);

  return { now, battery: batteryStatus };
}
