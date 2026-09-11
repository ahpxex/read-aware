import { AppError, type EntityIdentity, type EntityAlias, type IdentityConsolidationSnapshot } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";

export type IdentityClass = { id: string; definition: EntityIdentity["definition"]; members: EntityIdentity[]; aliases: EntityAlias[] };
export type IdentityInput = { memories: { id: string; content: string; kind: string; scope: string; evidenceCount: number; pinned: boolean; createdAt: string; updatedAt: string }[]; identities: IdentityClass[] };
export const identityBytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** A capacity miss is pending work, not a partial list falsely labelled complete. */
export async function readIdentityInput(snapshot: IdentityConsolidationSnapshot, registry: RuntimeDeps["entityRegistry"], maxBytes: number, signal?: AbortSignal): Promise<IdentityInput | null> {
  const input: IdentityInput = { memories: snapshot.sources.map(({ memory }) => ({ id: memory.id, content: memory.content, kind: memory.kind,
    scope: memory.scope, evidenceCount: memory.evidenceCount, pinned: memory.pinned ?? false,
    createdAt: memory.createdAt, updatedAt: memory.updatedAt })), identities: [] };
  const fits = () => identityBytes(JSON.stringify(input)) <= maxBytes;
  if (!fits()) return null;
  let offset = 0;
  do {
    signal?.throwIfAborted();
    const page = await registry.query({ kind: "identities", offset, limit: 100, expectedRevision: snapshot.entitiesRevision }, signal);
    if (page.kind !== "identities" || page.revision !== snapshot.entitiesRevision) throw new AppError("memory/conflict", "Registry changed during identity input assembly");
    for (const item of page.items) {
      const group: IdentityClass = { ...item, members: [], aliases: [] };
      input.identities.push(group);
      if (!fits()) return null;
      for (const kind of ["members", "aliases"] as const) {
        let start = 0;
        do {
          signal?.throwIfAborted();
          const part = await registry.query({ kind, entityId: item.id, offset: start, limit: 100, expectedRevision: snapshot.entitiesRevision }, signal);
          if (part.kind !== kind || part.revision !== snapshot.entitiesRevision || part.canonicalId !== item.id) throw new AppError("memory/conflict", "Registry class changed during identity input assembly");
          if (part.kind === "members") group.members.push(...part.items);
          else if (part.kind === "aliases") group.aliases.push(...part.items);
          if (!fits()) return null;
          if (part.nextOffset === null) break;
          if (part.nextOffset <= start) throw new AppError("memory/conflict", "Registry pagination did not advance");
          start = part.nextOffset;
        } while (true);
      }
    }
    if (page.nextOffset === null) break;
    if (page.nextOffset <= offset) throw new AppError("memory/conflict", "Registry pagination did not advance");
    offset = page.nextOffset;
  } while (true);
  signal?.throwIfAborted();
  return input;
}
