import { useEffect, useRef, useState } from "react";
import { useToast } from "@read-aware/ui";
import { describeError } from "../../../i18n/describe-error";
import { useTranslation } from "../../../i18n";
import { nativeDataLocation } from "../../../platform/data-location";
import { createLogger } from "../../../platform/logger";

type LocationState = { status: "loading" } | { status: "ready"; path: string }
  | { status: "failed"; error: unknown } | { status: "unsupported" };
const log = createLogger("data-location");

export function useDataLocation() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const [state, setState] = useState<LocationState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const active = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    if (!nativeDataLocation.supported()) {
      setState({ status: "unsupported" });
    } else {
      setState({ status: "loading" });
      void nativeDataLocation.read(controller.signal).then(path => {
        if (!controller.signal.aborted) setState({ status: "ready", path });
      }, error => {
        if (controller.signal.aborted) return;
        log.error("Reading the data directory failed", error);
        setState({ status: "failed", error });
      });
    }
    return () => { controller.abort(); };
  }, [revision]);

  const reveal = async () => {
    const owner = lifetime.current;
    if (state.status !== "ready" || active.current || !owner || owner.signal.aborted) return;
    active.current = true;
    setRevealing(true);
    try {
      await nativeDataLocation.reveal(owner.signal);
    } catch (error) {
      log.error("Revealing the data directory failed", error);
      if (!owner.signal.aborted) toast({ variant: "destructive", title: t("dataSync.noticeError"),
        description: describeError(error, { fallback: t("dataSync.dataLocation.revealFailed") }).body });
    } finally {
      active.current = false;
      if (!owner.signal.aborted) setRevealing(false);
    }
  };
  return { state, revealing, reveal, retry: () => setRevision(value => value + 1) };
}
