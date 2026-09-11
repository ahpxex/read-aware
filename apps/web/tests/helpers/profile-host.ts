import { AppError, userProfileRevision, type UserProfileSnapshot } from "@read-aware/core";
import { createUserProfileService } from "../../src/domain/user-profile";
import type { DomainEventDraft } from "../../src/platform/domain-events";

/** IPC orchestration fixture; atomic storage semantics are tested in native Rust. */
export async function profileHost(summary: string | null = "Original") {
  let snapshot: UserProfileSnapshot = { summary, revision: await userProfileRevision(summary, "seed") };
  const calls: { command: string; args: unknown }[] = [], broadcasts: DomainEventDraft[] = [];
  const controls = {
    initializationFailure: undefined as Error | undefined,
    readFailure: undefined as Error | undefined,
    migrated: false,
    beforeRead: async () => {}, beforeCommit: async () => {}, beforeMint: async () => {},
  };
  let serial = Promise.resolve<unknown>(undefined);
  const service = createUserProfileService({
    mint: async drafts => {
      await controls.beforeMint();
      return drafts.map(draft => ({ ...draft, id: crypto.randomUUID(), hlc: { wallMs: 1, counter: 1, deviceId: "test" } }));
    },
    broadcast: drafts => { broadcasts.push(...structuredClone(drafts)); },
    invoke: async <T>(command: string, args?: unknown): Promise<T> => {
      calls.push({ command, args: structuredClone(args) });
      if (command === "profile_initialize") {
        if (controls.initializationFailure) throw controls.initializationFailure;
        return { migrated: controls.migrated, snapshot: { ...snapshot } } as T;
      }
      if (command === "profile_inspect") {
        await controls.beforeRead();
        if (controls.readFailure) throw controls.readFailure;
        return { ...snapshot } as T;
      }
      if (command !== "profile_commit" && command !== "profile_restore") throw Error(`Unexpected IPC ${command}`);
      const input = structuredClone(args) as { expectedRevision: string; event: { id: string; payload: { summary: string }; origin: string } };
      const result = serial.then(async () => {
        await controls.beforeCommit();
        if (input.expectedRevision !== snapshot.revision) throw new AppError("memory/conflict", "Native profile conflict");
        const changed = input.event.payload.summary !== snapshot.summary;
        if (changed) snapshot = { summary: input.event.payload.summary, revision: await userProfileRevision(input.event.payload.summary, input.event.id) };
        return { changed, revision: snapshot.revision, persistence: "event-log" };
      });
      // A failed transaction does not block subsequent fixture transactions.
      serial = result.catch(() => {});
      return await result as T;
    },
  });
  return { service, calls, broadcasts, controls,
    current: () => ({ ...snapshot }),
    remote: async (value: string | null) => { snapshot = { summary: value, revision: await userProfileRevision(value, crypto.randomUUID()) }; },
  };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
