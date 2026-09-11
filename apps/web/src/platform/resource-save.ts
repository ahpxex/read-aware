/** The last authority check and write dispatch must have no asynchronous gap. */
export async function saveResourceFile(
  choose: () => Promise<string | null>,
  write: (path: string) => Promise<unknown>,
  signal?: AbortSignal,
  beforeWrite?: () => void,
): Promise<boolean> {
  signal?.throwIfAborted();
  beforeWrite?.();
  const path = await choose();
  signal?.throwIfAborted();
  beforeWrite?.();
  if (path === null) return false;
  await write(path);
  return true;
}
