# Agent Evaluations

ReadAware separates deterministic runtime tests from live, model-backed behavior
evaluations. `bun test` remains the hard correctness gate. The eval runner calls
the real `AgentThread` with isolated in-memory domain ports and records what the
model actually saw and did.

One deterministic layer lives below the eval runner: the tool-surface contract
(`src/tools/tool-surface.test.ts`). Every registered tool is executed against a
seeded fixture and its model-visible text must stay legible — no raw `*Ms`
fields, no epoch-millisecond numbers, bounded size. New tools must register a
surface case there; the completeness check fails otherwise.

## Suites

- `annotations`: verbatim highlights, faithful notes, lookup-then-edit, and
  summaries grounded in the recorded annotations.
- `karamazov`: real-book scenarios on the full Chinese Brothers Karamazov EPUB
  (`fixtures/karamazov.epub`, 102 chapters) — quote location at real scale,
  Chinese-language consistency, memory updates, and pretraining-knowledge
  spoiler pressure against an early cursor. Assertions derive from the fixture
  text itself; `seedSummary` keeps the novel out of run artifacts.
- `grounding`: honesty when data is missing — no invented chapters, durations,
  or shelf books.
- `reading`: reading-cursor grounding, selective spoiler protection, forward
  retrieval for expository books, same-chapter prompt-prefix stability, and
  cross-book prose search.
- `interactions`: clarification questions, destructive permissions, declined
  mutations, unnecessary-permission avoidance, answering in the user's
  language, and multi-turn recall via `get_recent_turns`.
- `settings`: generic discovery and mutation, book scope, ambiguous scope, and
  the credential boundary.
- `memory`: explicit user/book memory writes, grounded retrieval, and
  small-talk restraint.
- `tools`: shelf presentation, humane reading stats, trajectory economy
  (batched search variants, targeted chapter reads), no-false-success on
  missing books, presentation restraint, and plugin tool scope exposure.

List scenarios without loading credentials or calling a model:

```sh
bun run eval:agent settings --list
bun run eval:all --list
```

## Running

DeepSeek is the default provider. The runner reads `DEEPSEEK_API_KEY` or the
normal Pi CLI credential in `~/.pi/agent/auth.json`.

Thinking defaults to **off** (fast, cheap regression runs — and the floor for
legacy app configs, whose stored default is also off). Pass `--thinking low`
or `--thinking medium` to measure the app's configured tier. Tool discipline
is measurably worse at `off` (zero-retrieval turns, prose instead of ask_user);
compare runs only at the SAME level — trend files record `thinkingLevel` and
the delta printer marks cross-level comparisons as INCOMPARABLE.

```sh
# One fast pass over the reading suite
bun run eval:reading

# A more useful stochastic sample
bun run eval:reading --repetitions 5

# Parallel (scenario, repetition) units — variants inside a unit stay
# sequential and rotated, so paired comparisons are unaffected
bun run eval:all --repetitions 3 --concurrency 4

# One scenario, with behavioral failures promoted to a failing exit code
bun run eval:reading --scenario narrative-no-spoiler --repetitions 3 --gate

# Compare two models with paired scenario/repetition runs
bun run eval:reading \
  --model deepseek-v4-flash \
  --candidate-model deepseek-reasoner \
  --repetitions 5

# Cross-provider comparison (paired per scenario/repetition)
bun run eval:agent reading \
  --provider deepseek \
  --candidate candidate-openai=openai:gpt-5.6-sol \
  --repetitions 5

# Real-book suite across two providers
bun run eval:agent karamazov \
  --provider deepseek --model deepseek-v4-flash \
  --candidate glm=zai-coding-cn:glm-5.2 \
  --judge --judge-provider deepseek --judge-model deepseek-v4-flash \
  --repetitions 3 --concurrency 4
```

Candidate execution order rotates across repetitions. Reports compare only
matching scenario/repetition pairs, reducing time and provider-load bias.

Custom OpenAI-compatible providers use:

```sh
READAWARE_EVAL_BASE_URL=https://provider.example/v1 \
READAWARE_EVAL_API_KEY=... \
READAWARE_EVAL_MODEL=model-id \
bun run eval:reading custom
```

`READAWARE_EVAL_API` may be `openai-completions` or `openai-responses`.

## Quality Judge

Scenarios may declare a `rubric` — short, individually decidable statements
about answer quality that deterministic assertions cannot express (human units,
tone, engagement). Rubrics only score when a judge is enabled:

```sh
# Judge rubric scenarios with an LLM (default judge provider = baseline provider)
bun run eval:reading --repetitions 3 --judge

# Use a different judge model
bun run eval:reading --judge --judge-provider openai --judge-model gpt-5.6-sol
```

With `--judge` on, EVERY scenario is additionally scored against a global
quality rubric (directness / no filler, and companion-grade prose) — structure
passing while the prose is mediocre now shows up as a failing quality check.
Scenario-specific rubrics stack on top of the global one.

The judge sees the user turns, the tool trace, and the final answer, and must
return strict JSON scores per criterion. Verdicts become `quality`-category
checks (pass at score >= 0.6) merged into the same assessment. Parse failures
retry once, then surface as scoring errors — never silent passes. Judge checks
follow the usual gating rules: observations by default, failures only with
`--gate`.

## Artifacts

Every invocation creates an ignored `.eval/<run-id>/` bundle:

```text
manifest.json             run configuration, model metadata, git revision
runs.jsonl                one normalized record per attempted run
runs/<variant>/<case>/    full model-visible context, chunks, tools, answer
summary.json              aggregate and paired-comparison data
report.md                 readable summary
```

Bundles can contain book excerpts, questions, model reasoning, tool arguments,
and local paths. They are local diagnostic artifacts, not telemetry. API keys
are explicitly removed and common `sk-...` credential shapes are redacted as a
second line of defense. Do not commit or share a bundle without reviewing it.

Use `--no-artifacts` for an intentionally ephemeral run, or `--output-dir` to
place bundles under another local root.

Each artifact-producing run also updates `.eval/trend-<suite>.json` with the
baseline's per-scenario pass rate and mean score, and prints a delta against
the previous run — regressed scenarios are prefixed with `!`. The trend file
holds only the latest run; bundles remain the full history.

After changing deterministic checks, rescore an existing bundle without paying
for or rerunning the model:

```sh
bun run eval:rescore .eval/reading-<run-id>

# Additionally judge rubric scenarios against the recorded runs — the judge
# model is paid for, the evaluated model is NOT rerun
bun run eval:rescore .eval/reading-<run-id> --judge
```

This writes `rescored-runs.jsonl`, `rescored-summary.json`, and
`rescored-report.md` next to the immutable original run files.

## Scoring And CI

Assertions inspect both outcomes and trajectories: answer phrases, required or
forbidden tools, tool errors, interaction kinds, state mutations, model rounds,
and custom context invariants. Checks that can be deterministic should remain
deterministic; reserve `rubric` + `--judge` for criteria that genuinely need
semantic judgment.

By default, behavior failures are observations and do not change the process
exit code. Execution/setup/timeout/scoring errors always fail the command.
`--gate` additionally fails on behavior checks. Promote a live suite to a CI
gate only after repeated runs establish a stable baseline.

## Adding A Scenario

Define scenarios with `defineAgentEvalScenario()` under `src/evals/suites/`.
Keep fixture books synthetic and make expected facts explicit. Prefer:

1. A deterministic answer or state invariant.
2. A trajectory invariant explaining how the answer was obtained.
3. A serializable `criteria` field for every custom check.
4. Optionally a `rubric` for judge-scored quality dimensions — each entry one
   decidable statement, phrased so a grader can score it from the transcript
   alone.

Use `setup` only for domain seams the fixture cannot express, such as a declined
permission or a scope-filtered plugin tool. Use `observeState` to expose the
smallest post-run projection needed for scoring; never serialize an entire
credential-bearing runtime object.
