import { createFileRoute } from "@tanstack/react-router";
import App from "../App";

export const Route = createFileRoute("/")({
  component: IndexRouteComponent,
  pendingComponent: IndexRoutePending,
});

function IndexRouteComponent() {
  return <App />;
}

function IndexRoutePending() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 text-center text-stone-950">
      <div className="max-w-sm space-y-4">
        <p className="text-[10px] font-medium tracking-eyebrow text-stone-400 uppercase">
          ReadAware
        </p>
        <h1 className="font-serif text-4xl leading-display">
          Loading your reading workspace...
        </h1>
        <p className="text-sm leading-6 text-stone-600">
          Preparing your local library, reader state, and context surfaces.
        </p>
      </div>
    </main>
  );
}
