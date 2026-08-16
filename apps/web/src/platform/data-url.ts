/**
 * `data:` URL ↔ bytes codecs. Covers (and any small binary cached for
 * synchronous paint) live as data URLs in projections but travel as blobs;
 * these two functions are the seam between the representations.
 */

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/.exec(dataUrl);
  if (!match) return null;
  const [, mimeType, base64, payload] = match;
  try {
    if (base64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { bytes, mimeType: mimeType || "application/octet-stream" };
    }
    return {
      bytes: new TextEncoder().encode(decodeURIComponent(payload)),
      mimeType: mimeType || "text/plain",
    };
  } catch {
    return null;
  }
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Unable to encode bytes as a data URL."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to encode bytes as a data URL."));
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type: mimeType }));
  });
}
