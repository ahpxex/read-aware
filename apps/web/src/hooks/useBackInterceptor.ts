import { useEffect, useRef } from "react";
import { registerBackInterceptor } from "../platform/back-navigation";

/**
 * Claims the Android back gesture for a deeper UI layer while the caller is
 * mounted. The interceptor is read through a ref, so callers may pass a fresh
 * closure every render; return `true` to consume the back request (after
 * closing the layer), `false` to let it fall through to the app-level unwind.
 */
export function useBackInterceptor(interceptor: () => boolean): void {
  const interceptorRef = useRef(interceptor);
  interceptorRef.current = interceptor;
  useEffect(() => registerBackInterceptor(() => interceptorRef.current()), []);
}
