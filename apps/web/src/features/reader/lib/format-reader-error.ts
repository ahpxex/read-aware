export function formatReaderError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unable to load this file.";
}
