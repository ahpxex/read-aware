import { useState, type FormEvent } from "react";
import { Body, Button, Caption } from "@read-aware/ui";
import { joinWaitlist } from "../lib/loops";

type FormState = "idle" | "loading" | "success" | "error";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;

    setState("loading");
    setError("");

    const outcome = await joinWaitlist(email);
    if (outcome.status === "success") {
      setState("success");
      return;
    }

    setState("error");
    setError(outcome.message);
  }

  if (state === "success") {
    return (
      <div className="flex min-h-10 items-center" role="status" aria-live="polite">
        <Body className="text-stone-700">
          Thanks — you're on the list. We'll be in touch.
        </Body>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          disabled={state === "loading"}
          className="h-10 flex-1 rounded-md border border-border bg-white px-3.5 font-sans text-base text-stone-950 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-950/10 disabled:opacity-60"
        />
        <Button type="submit" size="lg" disabled={state === "loading"}>
          {state === "loading" ? "Joining…" : "Join Waitlist"}
        </Button>
      </div>
      {state === "error" && (
        <Caption className="mt-2 block text-red-700" role="alert">
          {error}
        </Caption>
      )}
    </form>
  );
}
