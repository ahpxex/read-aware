/**
 * Parse Server-Sent Events from a ReadableStream.
 * Yields individual `data:` payloads as strings.
 */
export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);
          if (data === "[DONE]") return;
          yield data;
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        if (data !== "[DONE]") yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
