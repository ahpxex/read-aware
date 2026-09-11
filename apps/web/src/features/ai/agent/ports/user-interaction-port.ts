import type {
  UserInteractionAnswer,
  UserInteractionPort,
} from "@read-aware/agent";
import { validateInteractionForm, validateInteractionFormValues, type InteractionForm } from "@read-aware/core";

type PendingInteraction = {
  resolve: (answer: UserInteractionAnswer) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  form?: InteractionForm;
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
  let accepted = answer;
  if (entry.form) {
    if (answer.cancelled === true) accepted = { cancelled: true };
    else {
      // Rejected drafts remain editable; only validated fields can settle a form.
      try {
        const result = validateInteractionFormValues(entry.form, answer.values);
        if (Object.keys(result.errors).length) return false;
        accepted = { values: result.values };
      } catch { return false; } // Invalid UI payload is not a submitted answer.
    }
  }
  pending.delete(id);
  detach(entry);
  entry.resolve(structuredClone(accepted));
  return true;
}

export function createUserInteractionPort(): UserInteractionPort {
  return {
    request: async (request, signal) => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("Interaction aborted", "AbortError"));
      }
      if (pending.has(request.id)) {
        return Promise.reject(new Error(`interaction already pending: ${request.id}`));
      }
      const form = request.kind === "form" ? validateInteractionForm({ title: request.title, fields: request.fields }) : undefined;
      return new Promise<UserInteractionAnswer>((resolve, reject) => {
        const entry: PendingInteraction = { resolve, reject, signal, form };
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
