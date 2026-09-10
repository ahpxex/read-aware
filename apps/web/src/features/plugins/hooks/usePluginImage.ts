import { useEffect, useRef, useState } from "react";
import { AppError } from "@read-aware/core";
import type { PluginImageView } from "../lib/plugin-types";
import { pluginImageOwner, type PluginImageOwner } from "../lib/plugin-image-owner";

type State = { owner?: PluginImageOwner; id: string; attempt: number; url?: string; loaded?: boolean; error?: unknown };

export function usePluginImage(view: PluginImageView) {
  const owner = pluginImageOwner(view), id = view.resourceId;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ id, attempt });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(); pending.current = abort;
    setState({ owner, id, attempt });
    const result = owner ? owner.acquire(id, abort.signal)
      : Promise.reject(new AppError("plugin/unavailable", "Image declaration has no resource owner"));
    void result.then(lease => {
      if (abort.signal.aborted) { lease.release(); return; }
      setState({ owner, id, attempt, url: lease.url });
    }, error => {
      if (!abort.signal.aborted) setState({ owner, id, attempt, error });
    });
    return () => { abort.abort(); if (pending.current === abort) pending.current = null; };
  }, [owner, id, attempt]);
  const current = state.owner === owner && state.id === id && state.attempt === attempt ? state : undefined;
  return {
    url: current?.url, loaded: current?.loaded ?? false, error: current?.error,
    retry: () => setAttempt(value => value + 1),
    loadedImage: () => setState(value => value === current ? { ...value, loaded: true } : value),
    failedImage: () => {
      pending.current?.abort();
      setState({ owner, id, attempt, error: new AppError("ui/unavailable", "Image preview could not be displayed") });
    },
  };
}
