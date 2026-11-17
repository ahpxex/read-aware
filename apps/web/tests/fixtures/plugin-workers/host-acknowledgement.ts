/**
 * Inside the plugin Worker, contribution and observation handles are also
 * promises that settle once the host has accepted or rejected the call
 * (`callHost` in plugin-sandbox.worker.ts). The public plugin types expose only
 * the disposable, so probes that must observe host acceptance or rejection
 * await the handle through this helper instead of awaiting a non-thenable type.
 */
export function hostAcknowledgement<T>(handle: T): Promise<Awaited<T>> {
  return Promise.resolve<T>(handle);
}
