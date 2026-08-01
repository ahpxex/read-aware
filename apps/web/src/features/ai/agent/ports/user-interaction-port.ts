import type {
  UserInteractionAnswer,
  UserInteractionPort,
} from "@read-aware/agent";

type PendingInteraction = {
  resolve: (answer: UserInteractionAnswer) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const pending = new Map<string, PendingInteraction>();

function detach(entry: PendingInteraction): void {
  if (entry.signal && entry.onAbort) {
    entry.signal.removeEventListener("abort", entry.onAbort);
  }
}

/** Called by ChatInteractionPrompt; false means the turn no longer owns it. */
export function respondToUserInteraction(
  id: string,
  answer: UserInteractionAnswer,
): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  detach(entry);
  entry.resolve(answer);
  return true;
}

export function createUserInteractionPort(): UserInteractionPort {
  return {
    request: (request, signal) => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("Interaction aborted", "AbortError"));
      }
      if (pending.has(request.id)) {
        return Promise.reject(new Error(`interaction already pending: ${request.id}`));
      }
      return new Promise<UserInteractionAnswer>((resolve, reject) => {
        const entry: PendingInteraction = { resolve, reject, signal };
        entry.onAbort = () => {
          if (pending.get(request.id) !== entry) return;
          pending.delete(request.id);
          detach(entry);
          reject(new DOMException("Interaction aborted", "AbortError"));
        };
        pending.set(request.id, entry);
        signal?.addEventListener("abort", entry.onAbort, { once: true });
      });
    },
  };
}
