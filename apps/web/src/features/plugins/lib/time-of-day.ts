/**
 * The stored form of a `time` settings field: 24-hour `HH:MM`.
 *
 * Its own module because three layers need the same answer — manifest
 * validation, the runtime view boundary, and the agent's settings catalog —
 * and none of them should have to import another's machinery to ask.
 */
export function isTimeOfDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return !!match && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}
