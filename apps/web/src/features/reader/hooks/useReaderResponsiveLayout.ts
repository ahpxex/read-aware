import { useEffect, useState } from "react";
import { PHONE_VIEWPORT_QUERY } from "@read-aware/ui/media";
import { causalActor } from "../../../platform/domain-actor";

/** Whether the reader uses the phone layout, switched as soon as the window
 * crosses the breakpoint. A layout change is the system's doing; whoever
 * resized the window gets the result from that command's receipt. */
export function useReaderResponsiveLayout() {
  const [layout, setLayout] = useState(() => ({
    exclusive: typeof window !== "undefined" && window.matchMedia(PHONE_VIEWPORT_QUERY).matches,
    origin: causalActor("system"),
  }));
  useEffect(() => {
    const media = window.matchMedia(PHONE_VIEWPORT_QUERY);
    let published = layout.exclusive;
    const changed = () => {
      if (media.matches === published) return;
      published = media.matches;
      setLayout({ exclusive: published, origin: causalActor("system") });
    };
    media.addEventListener("change", changed);
    changed();
    return () => media.removeEventListener("change", changed);
    // The subscription owns its last published choice across React commits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return layout;
}
