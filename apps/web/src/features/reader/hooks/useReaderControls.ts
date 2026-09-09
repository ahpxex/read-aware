import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createLogger } from "../../../platform/logger";
import { ReadingControlsController } from "../lib/reading-controls-controller";

const log = createLogger("reader-controls");

export function useReaderControls() {
  const [controls] = useState(() => new ReadingControlsController(error => log.warn("Controls observer failed", error)));
  const state = useSyncExternalStore(controls.subscribeRender, controls.getRenderState);
  useLayoutEffect(() => controls.acknowledge(state), [controls, state]);
  useEffect(() => () => controls.retire(), [controls]);
  return { controls, visible: state.visible, setVisible: controls.setFromUI };
}
