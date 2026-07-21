/** Case-insensitive substring match over any of the given fields. */
export function matchesPluginQuery(
  query: string,
  ...fields: (string | undefined)[]
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}
