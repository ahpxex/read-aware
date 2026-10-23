/** The last authority check and write dispatch must have no asynchronous gap.
 * `choose` resolves to an opaque native save grant, never a writable path. */
export async function saveResourceFile(
  choose: () => Promise<string | null>,
  write: (target: string) => Promise<boolean>,
  signal?: AbortSignal,
  beforeWrite?: () => void,
): Promise<boolean> {
  signal?.throwIfAborted();
  beforeWrite?.();
  const target = await choose();
  signal?.throwIfAborted();
  beforeWrite?.();
  if (target === null) return false;
  // iOS picks the destination in the export picker at write time; `false`
  // means the user cancelled there — the same outcome as a null pick.
  return write(target);
}
