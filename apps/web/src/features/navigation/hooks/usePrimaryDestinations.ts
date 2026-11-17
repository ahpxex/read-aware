/**
 * The primary navigation's destinations, in the user's order, as the
 * centered switcher renders them. The header's back-button reachability
 * guard keys off this list too.
 */
import { useDestination, useMenuLayouts, type Destination } from "../../menus";

export type PrimaryDestination = Pick<Destination, "id" | "topNav" | "label">;

export function usePrimaryDestinations(): PrimaryDestination[] {
  const layouts = useMenuLayouts();
  const describe = useDestination();
  return layouts.primaryNav.visible
    .map(describe)
    .filter((destination): destination is Destination => destination !== null)
    .map(({ id, topNav, label }) => ({ id, topNav, label }));
}
