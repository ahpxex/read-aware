# Agent Evaluations

ReadAware separates deterministic runtime tests from live, model-backed behavior
evaluations. `bun test` remains the hard correctness gate. The eval runner calls
the real `AgentThread` with isolated in-memory domain ports and records what the
model actually saw and did.

## Suites

- `reading`: reading-cursor grounding, selective spoiler protection, forward
  retrieval for expository books, and same-chapter prompt-prefix stability.
- `interactions`: clarification questions, destructive permissions, declined
  mutations, and avoiding unnecessary permission prompts.
- `settings`: generic discovery and mutation, book scope, ambiguous scope, and
  the credential boundary.
- `memory`: explicit user/book memory writes and grounded retrieval.
- `tools`: shelf presentation and plugin tool scope exposure.

List scenarios without loading credentials or calling a model:

```sh
bun run eval:agent settings --list
bun run eval:all --list
```

## Running

DeepSeek is the default provider. The runner reads `DEEPSEEK_API_KEY` or the
normal Pi CLI credential in `~/.pi/agent/auth.json`.

```sh
# One fast pass over the reading suite
bun run eval:reading

# A more useful stochastic sample
bun run eval:reading --repetitions 5

# One scenario, with behavioral failures promoted to a failing exit code
bun run eval:reading --scenario narrative-no-spoiler --repetitions 3 --gate

# Compare two models with paired scenario/repetition runs
bun run eval:reading \
  --model deepseek-v4-flash \
  --candidate-model deepseek-reasoner \
  --repetitions 5

# Cross-provider comparison
bun run eval:agent reading \
  --provider deepseek \
  --candidate candidate-openai=openai:gpt-5.6-sol \
  --repetitions 5
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

After changing deterministic checks, rescore an existing bundle without paying
for or rerunning the model:

```sh
bun run eval:rescore .eval/reading-<run-id>
```

This writes `rescored-runs.jsonl`, `rescored-summary.json`, and
`rescored-report.md` next to the immutable original run files.

## Scoring And CI

Assertions inspect both outcomes and trajectories: answer phrases, required or
forbidden tools, tool errors, interaction kinds, state mutations, model rounds,
and custom context invariants. Checks that can be deterministic should remain
deterministic; use a model judge only when a future criterion genuinely needs
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

Use `setup` only for domain seams the fixture cannot express, such as a declined
permission or a scope-filtered plugin tool. Use `observeState` to expose the
smallest post-run projection needed for scoring; never serialize an entire
credential-bearing runtime object.
