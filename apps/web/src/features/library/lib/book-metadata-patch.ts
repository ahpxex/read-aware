type Metadata = { title: string; author: string };

export function bookMetadataPatch(current: Metadata, requested: Partial<Metadata>): Partial<Metadata> {
  const title = requested.title?.trim() || current.title;
  const author = requested.author === undefined ? current.author : requested.author.trim();
  return { ...(title !== current.title ? { title } : {}), ...(author !== current.author ? { author } : {}) };
}
