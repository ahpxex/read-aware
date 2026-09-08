import type { VirtualBookContent } from "../../reader/lib/virtual-book";

export async function digestContent(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function virtualContentVersion(content: VirtualBookContent): Promise<string> {
  return `virtual:sha256:${await digestContent(JSON.stringify({
    title: content.title ?? "", author: content.author ?? "", language: content.language ?? "en",
    sections: content.sections.map((section, index) => ({ id: section.id || `sec-${index}`, title: section.title ?? "", html: section.html })),
  }))}`;
}
