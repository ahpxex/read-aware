/** Yield to timers/Worker messages, not only to the microtask queue. */
export function cooperativeCheckpoint(signal?: AbortSignal): () => Promise<void> | undefined {
    let deadline = performance.now() + 8
    return () => {
        signal?.throwIfAborted()
        if (performance.now() < deadline) return
        return new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => {
            signal?.throwIfAborted()
            deadline = performance.now() + 8
        })
    }
}
