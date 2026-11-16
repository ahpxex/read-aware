/**
 * The environment evals run in.
 *
 * A scenario's book thread needs a book: its text, its chapters, where the
 * reader is in it. The agent package cannot reach the app (the dependency runs
 * the other way), so the app installs a host here before a run: its own
 * parser, extraction, search and location code over a headless shell. What an
 * eval then exercises above the native boundary is the app.
 *
 * Without an installed host, scenarios run on the in-memory fixtures. That is
 * right for scenarios whose books are a few seeded lines of text, and wrong for
 * a real book, whose chapters and coordinates are whatever the app makes of
 * it: a real-book scenario refuses to run here.
 */
import type { RuntimeDeps } from "../ports";
import type { SendTurnInput } from "../runtime/thread";
import { createInMemoryDeps, type InMemorySeed, type InMemoryStores } from "../testing/fixtures";
import { locateFixtureTurn } from "../testing/plain-text-layout";
import type { ThreadScope } from "../thread-scope";
import { isRealBookId } from "./book-fixtures";

type EvalTurn = Omit<SendTurnInput, "signal">;
/** What a host needs to know of a scenario to build its environment. */
export type EvalScenarioSource = { id: string; seed: InMemorySeed; scope: ThreadScope };

export interface EvalEnvironment {
  deps: RuntimeDeps;
  stores: InMemoryStores;
  /** Which book pipeline this scenario ran on; recorded with the run. */
  environment: string;
  /** Present the reader's page and selection of a turn the way this environment's reader reports them. */
  locateTurn(turn: EvalTurn): EvalTurn | Promise<EvalTurn>;
}

export interface EvalHost {
  id: string;
  createEnvironment(
    scenario: EvalScenarioSource,
  ): EvalEnvironment | Promise<EvalEnvironment>;
}

export const IN_MEMORY_ENVIRONMENT = "in-memory";

/** The seeded fixtures: a book is the chapter text of the seed, and a page is where its words occur in that text. */
export function createInMemoryEnvironment(scenario: Pick<EvalScenarioSource, "seed" | "scope">): EvalEnvironment {
  const context = createInMemoryDeps(scenario.seed);
  const { scope } = scenario;
  return {
    ...context,
    environment: IN_MEMORY_ENVIRONMENT,
    locateTurn: (turn) =>
      scope.kind === "book" ? locateFixtureTurn(turn, context.stores.chapters.get(scope.bookId)) : turn,
  };
}

const inMemoryHost: EvalHost = {
  id: IN_MEMORY_ENVIRONMENT,
  createEnvironment: (scenario) => {
    const real = Object.keys(scenario.seed.chapters ?? {}).filter(isRealBookId);
    if (real.length)
      throw new Error(
        `Scenario ${scenario.id} reads a real book (${real.join(", ")}), which runs on the app's headless host: start it with \`bun run eval\` from apps/web.`,
      );
    return createInMemoryEnvironment(scenario);
  },
};

let installed: EvalHost = inMemoryHost;

/** Called once by the process that owns the environment, before any scenario runs. */
export function installEvalHost(host: EvalHost): void {
  installed = host;
}

export function evalHost(): EvalHost {
  return installed;
}
