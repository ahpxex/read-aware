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

## Organization: Groups, Suites, Tags

Three nested axes answer "what test is what kind of test":

- **Group** (`behavior` / `realbook`) — the run/report unit above suites.
  `behavior` = capability suites over synthetic fixtures (what discipline is
  tested). `realbook` = per-book suites + the generated grid (which book is
  tested). The two axes are orthogonal on purpose: crossbook/journeys/legacy
  use real books as *props* but live in `behavior` because their identity is
  the capability, not the book.
- **Suite** — stable id + append-only code (`S01`…). The id is the foreign key
  for trend files (`trend-<id>.json`), artifact bundles, and viewer routes;
  it never changes once published. 17 suites, ~245 scenarios.
- **Tags** — a closed vocabulary (`src/evals/tags.ts`) classifying every
  scenario along a capability axis (what behavior) and a modifier axis (what
  shape), plus an open book-slug axis. Tags are validated by
  `suites/suites.test.ts`; out-of-vocabulary tags fail `bun test`.

### Tag vocabulary

Capability axis — what behavior is tested:

| Tag | Meaning |
| --- | --- |
| `spoiler` | Spoiler-fence discipline: holding the fence, explicit grants, no-cursor caution |
| `cursor` | Reading-cursor grounding: page-level questions, cursor refresh, prefix stability |
| `retrieval` | Search and locate: topical lookups, quote location, cross-book attribution |
| `economy` | Trajectory economy: batched query variants, targeted chapter reads |
| `state` | Durable writes: settings, shelf mutations, verbatim annotation fidelity |
| `memory` | Memory: write / retrieve / apply / restraint / transparency |
| `permission` | Destructive permission flows: request, decline-preserves, no over-asking |
| `interaction` | ask_user clarification and other in-chat interaction surfaces |
| `continuity` | Recall across turns / chapters / context resets |
| `presentation` | Host-owned cards and presentation restraint |
| `honesty` | Honesty under missing data: no invented chapters, durations, shelves, memories |
| `language` | Answer in the user's language; bilingual discipline |
| `toc` | TOC facts and navigation (volume structure, real extent) |
| `digest` | Chapter-digest / concept-graph injection surfaces (`query_book_graph`) |
| `security` | Security boundaries: unreachable credentials, plugin tool scoping |
| `tool-surface` | Plugin tool exposure and execution |

Modifier axis — what shape the scenario takes: `control` (negative-control
twin, assertions inverted), `grant` (explicit spoiler grant), `finished`
(reader finished the book, no fence), `forward` (forward retrieval past the
cursor), `selection` (visible-text selection), `multi-turn`, `global`
(Context-page thread), `book` (in-book thread).

Book axis (open): real-book slugs from the fixture registry — `karamazov`,
`santi`, `lebon`, `berger`, `refactoring`.

Filter scenarios by tag across a suite or a whole group:

```sh
bun run eval:agent behavior --tag spoiler,permission
bun run eval:agent realbook --tag control
```

Tag rollups are first-class outputs: every report gains a `## Tags` section,
and each trend file stores per-scenario tags plus a `byTag` rollup whose
deltas print next to per-scenario regressions.

## Suites

### behavior — capability suites

- `reading` (S12): reading-cursor grounding, selective spoiler protection,
  forward retrieval for expository books, same-chapter prompt-prefix
  stability, and cross-book prose search.
- `grounding` (S04): honesty when data is missing — no invented chapters,
  durations, shelves, unknown books, memories, or highlights.
- `memory` (S10): explicit user/book memory writes, retrieval from outside the
  injection window, note-vs-memory routing, book-scope isolation (control),
  first-session onboarding questions, and small-talk restraint.
- `personalization` (S11): memory must CHANGE the answer, or it is a black box
  and the memory-first principle is violated. A concrete persona (family
  wound, political-science grad student, prefers short plain answers, plays
  Minecraft, builds products with coding agents) drives five application
  surfaces: style (a hard length gate the concision preference must pass),
  unprompted domain connection, analogies drawn from the reader's world,
  discretion (no verbatim dossier recitals, no off-topic memory dumping), and
  transparency ("what do you remember about me" gets an honest, correctable
  answer) — plus a stale-memory correction that must be recorded via
  remember. Key scenarios carry no-profile CONTROL twins whose assertions
  invert (a field the agent cannot know must NOT appear).
- `annotations` (S01): verbatim highlights, faithful notes, lookup-then-edit,
  and summaries grounded in the recorded annotations.
- `interactions` (S05): clarification questions, destructive permissions,
  declined mutations, clarify-then-execute and cancelled-clarification abort,
  unnecessary-permission avoidance, answering in the user's language, and
  multi-turn recall via `get_recent_turns`.
- `settings` (S16): generic discovery and mutation, book scope, ambiguous
  scope, and the credential boundary.
- `tools` (S17): shelf presentation, humane reading stats, trajectory economy
  (batched search variants, targeted chapter reads), no-false-success on
  missing books, presentation restraint, and plugin tool scope exposure.
- `crossbook` (S03): global-thread behaviors over a shelf of four real books —
  "which book said this" attribution, cross-book synthesis (deliberately also
  the watchpost for the known gap that the global thread arms no host spoiler
  fence — prompt discipline only), and shelf-grounded recommendations rendered
  as cards.
- `journeys` (S06): whole-session journeys (read → highlight → note → remember)
  on real books; state writes under real pacing.
- `legacy` (S09): long-time users arriving with old baggage. Three inheritance
  pressures: the graph-backlog interim state (mid-book progress, zero digests
  — degrade to retrieval, don't hallucinate a graph), old-transcript
  inheritance (recall the reader's stated views via search_conversation /
  get_recent_turns, never claim amnesia), and critical appraisal — a past
  assistant's misattribution must be re-verified against the book and
  corrected, not parroted. The deterministic half (legacy-thread adoption:
  bootstrap rolling summary + inherited memory extraction, insights row as
  the watermark) lives in runtime/legacy-adoption.test.ts.

### realbook — per-book suites + the grid

Each per-book suite has two layers: **hand-written core scenarios** (the
angles only that book can test — spoiler tension, concept graphs, catalog
lookup) in the book's main file, plus a **real-reader question bank**
(`suites/realbook/<book>-questions.ts`, ~22-27 scenarios each, produced
through the `bookQuestion` factory in `question-factories.ts`) simulating
what a person actually asks while reading that book at that position:
term/concept explanations, fuzzy entity references ("那个抽烟的警察是谁"),
nickname-vs-full-name untangling, quote attribution, "where was that
passage", current/previous chapter recaps, progress management, suspense
suspension (questions the read side cannot answer yet must be HELD OPEN,
not answered from later-book truth), same-question-two-positions (the
answer should deepen as the cursor advances — or stay invariant on
expository books), paraphrase invariance (same intent, three wordings),
annotation/note assists with verbatim fidelity, reading-stats queries, and
off-shelf recommendations (framed as world knowledge, never fake cards).
Every assertion word is verified against the fixture (first occurrence ≤
cursor, or an explicitly legal forward target; leak words verified beyond).

- `karamazov` (S07): real-book scenarios on the full Chinese Brothers Karamazov
  EPUB (`fixtures/karamazov.epub`, 102 chapters) — quote location at real
  scale, Chinese-language consistency, memory updates, and pretraining-knowledge
  spoiler pressure against an early cursor. Assertions derive from the fixture
  text itself; `seedSummary` keeps the novel out of run artifacts. The
  question bank adds the famous-Inquisitor door (chapter title visible ahead,
  content fenced), the Smerdyakov position trap (his parentage rumor first
  appears #39 — beyond the fence), Russian-nickname untangling, and the
  two-position Ivan portrait.
- `santi` (S15): second narrative real book — the full Chinese Three-Body
  trilogy omnibus (`fixtures/santi.epub`, 61 sections / ~900k chars). What
  karamazov cannot test: maximum pretraining fame (the model knows the whole
  plot) vs an early cursor — including the famous-quote recital door (the
  internet-famous lines must not be recited un-granted); multi-volume fence
  granularity (volume I finished, volume II still fenced — Ye Wenjie's
  arc-ending discussion must not reach into 罗辑/宇宙社会学); multi-volume
  TOC navigation and omnibus structure fidelity (volume titles are
  reader-visible and answerable, this edition's mega-part structure is the
  truth, not the standalone edition's chapter list); and the messy real
  structure of a converted omnibus (volume-level NCX, whole-part
  mega-chapters in volumes II/III). The question bank adds the
  suspense-suspension family (the countdown's true meaning must be HELD
  OPEN at chapter 20 — answering it with 智子 is the pretraining leak).
- `lebon` (S08): expository real book — the full Chinese Le Bon
  (`fixtures/lebon.epub`, 18 chapters). The counterpart surface to the
  narrative suites: concept-graph injection ("argument so far" instead of
  characters/relations) — both the taxonomy recital and the whole-arc
  synthesis, plus transferring the graph to a domain the book predates
  (social media, reasoned from the book's own mechanisms); free forward
  retrieval with zero spoiler ceremony; and this-edition terminology
  fidelity. The question bank adds the translation-source honesty case (the
  fixture never marks 威望's original word — outside knowledge must be
  labeled as such), the era-limitations discussion, and the
  two-position invariance pair (prestige taxonomy answered identically at
  25% via forward retrieval and at 68% directly).
- `berger` (S02): how-to real book — the full Chinese Berger
  (`fixtures/berger.epub`, 10 chapters). The tool-book angle: the reader
  brings a real situation and the answer must APPLY the finished chapters'
  methods to it — explaining the methods AND coaching with them (turning them
  into usable questions for the reader's actual stakes) — plus an honest
  finish/don't-finish recommendation for a reader with a stated background,
  and zero-ceremony forward peeks at later chapters. The question bank adds
  multi-situation coaching (retrospective meetings, parenting, team
  creativity), the too-idealistic pushback conversation, and the
  same-intent-three-wordings invariance run.
- `refactoring` (S14): technical real book — the full English Refactoring 2nd
  ed (`fixtures/refactoring.epub`, 23 sections / ~730k chars, images stripped
  from the fixture, text untouched). What only a technical book tests: catalog
  lookup landing on the book's own chapter numbering, the smell vocabulary
  answered from the concept graph, the inverse direction (symptom → smell →
  refactoring diagnosis), a remember-goal-then-recommend-next-chapter
  coaching loop over the real TOC, and bilingual discipline — a Chinese
  reader gets a Chinese answer with the book's English terms intact. The
  question bank adds the bilingual reverse direction (naming smells in
  English from Chinese), more catalog lookups, a three-turn code
  consultation ending on the testing discipline, and the
  how-to-use-a-big-book guidance case.
- `realbooks` (S13): the common behavior grid, GENERATED over every registered
  real book from one config table (`suites/realbook/real-book-common.ts`) —
  topical lookup without position interrogation, selected-passage
  explanation, verbatim highlight + note flows, chapter-crossing recall
  across the context reset, no-cursor spoiler caution (narrative books), and
  quote location for books whose own suites don't cover it. Adding a book to
  the registry automatically enrolls it here.

List scenarios without loading credentials or calling a model:

```sh
bun run eval:agent settings --list
bun run eval:agent behavior --list
bun run eval:all --list
```

Two standalone runners sit beside the suites:

```sh
# Regenerate a real book's digest fixture with the production pipeline
bun run eval:digests <slug> [--resume]

# The narrativity classifier against every registered book (5 fast calls;
# a misclassification flips the fence AND the digest flavor for that book)
bun run eval:classify
```

## Running

**OpenRouter is the default provider** (default model
`deepseek/deepseek-v4-flash-0731` — the undated slug is the stale 0423
snapshot, not a rolling alias), reading `OPENROUTER_API_KEY` or the Pi CLI
credential in `~/.pi/agent/auth.json` (`openrouter` entry; the key itself
lives in 1Password as "OpenRouter API Key - Deepseek"). Every eval-side
OpenRouter request carries a routing preference — CoreWeave first,
fallbacks allowed (`applyEvalRouting` in `evals/model-config.ts`) — because
the official DeepSeek API got expensive; this preference is eval-only and
never leaks into the product, where OpenRouter users own their account
routing. `--provider deepseek` still works for the old direct path.

Thinking defaults to **medium** — the tier regressions should be measured at.
Pass `--thinking off` only for a deliberately cheap smoke pass. Tool discipline
is measurably worse at `off` (zero-retrieval turns, prose instead of ask_user);
compare runs only at the SAME level — trend files record `thinkingLevel` and
the delta printer marks cross-level comparisons as INCOMPARABLE.

```sh
# One fast pass over the reading suite
bun run eval:reading

# A more useful stochastic sample
bun run eval:reading --repetitions 5

# One capability group (11 suites), or the real-book group (6 suites)
bun run eval:behavior
bun run eval:agent realbook --repetitions 3

# Everything, group by group (behavior first, then realbook)
bun run eval:all --repetitions 3 --concurrency 4

# One capability axis across all capability suites
bun run eval:agent behavior --tag spoiler

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

Group targets accept the same options as single suites; suites with no
matching `--scenario`/`--tag` filter are skipped (unknown scenario ids still
error against the group's union). Judge and model variants are built once and
reused across the group's suites; each suite keeps its own artifact bundle
and trend file.

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

## Machine Quality Judge

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

This model-based judge is a scalable signal, not the release owner. In
particular, using the evaluated model as its own judge is not independent
evidence. Real-book release decisions require the qualitative workflow below.

## Qualitative And Human Judge

For real-book evals, the primary agent owns a reader-level review of the actual
answers. It must inspect every failed/error sample, every scenario directly
affected by the change, and a representative set of machine passes. The review
asks whether the response is correct, sufficiently grounded, complete, useful
at that reading moment, and appropriately restrained. Machine pass rate and an
LLM judge score must never be reported as a substitute for this judgement.

The Run page in the eval viewer is the shared review workspace. It shows the
reader question and complete model answer without a collapsed disclosure, and
stores a human verdict (`pass` / `partial` / `fail`), four 1–5 dimensions
(correctness, completeness, helpfulness, restraint), issue flags, and notes.
Both the primary agent and the user can review the same samples and revise a
saved assessment.

Fixed scenarios are not enough for qualitative behavior. From any recorded
scenario, the viewer can start a manual session that reconstructs the same
book seed, scope, reading cursor, optional selection, provider, model, and
thinking level. Questions and follow-ups run through a real persistent
`AgentThread`. Manual sessions survive as review artifacts; after the viewer
server restarts their transcripts remain reviewable, but a new live session is
required for another follow-up.

A release conclusion reports three signals separately: deterministic checks,
machine quality judge, and primary-agent/human satisfaction. A machine-green
answer that a reader would reject is a product failure, not an eval success.

## Artifacts

Every invocation creates an ignored `.eval/<run-id>/` bundle:

```text
manifest.json             run configuration, model/judge metadata, git revision,
                          and SHA-256 prompt/evaluator/runtime/fixture provenance
runs.jsonl                one normalized record per attempted run
runs/<variant>/<case>/    full model-visible context, chunks, tools, answer
summary.json              aggregate and paired-comparison data
report.md                 readable summary
human-reviews.json         mutable local human verdicts, dimension scores, flags, notes
manual-sessions.json       freeform reader questions, follow-ups, answers, tools, telemetry
```

Browse everything in the **eval viewer** (`bun run eval:ui`, port 5199 —
`packages/agent/eval-viewer`): the suite catalog grouped by behavior/realbook with
stable reference codes (scenarios are cited as `S07.3`), each scenario's
definition (turns, expectations, rubric, seed), and every run bundle rendered
as a full report and review workspace. Suites carry a `code` field — codes are
append-only and never reused.

Bundles can contain book excerpts, questions, model reasoning, tool arguments,
and local paths. They are local diagnostic artifacts, not telemetry. API keys
are explicitly removed and common `sk-...` credential shapes are redacted as a
second line of defense. Do not commit or share a bundle without reviewing it.

Use `--no-artifacts` for an intentionally ephemeral run, or `--output-dir` to
place bundles under another local root.

Each artifact-producing run also updates `.eval/trend-<suite>.json` with the
baseline's per-scenario pass rate and mean score (plus per-scenario tags and a
`byTag` rollup), and prints a delta against the previous run — regressed
scenarios are prefixed with `!`, regressed tag rollups appear under
`Tag rollup`. The trend file holds only the latest run; bundles remain the
full history.
Trend entries carry the eval-definition hash. When scenario inputs, evaluator
code, or scoring configuration changes, the CLI labels the runs
`INCOMPARABLE` and suppresses misleading scenario/tag deltas.

After changing deterministic checks, rescore an existing bundle without paying
for or rerunning the model:

```sh
bun run eval:rescore .eval/reading-<run-id>

# Additionally judge rubric scenarios against the recorded runs — the judge
# model is paid for, the evaluated model is NOT rerun
bun run eval:rescore .eval/reading-<run-id> --judge
```

Each invocation writes a new immutable
`rescored/<timestamp>-<id>/{manifest.json,runs.jsonl,summary.json,report.md}`
directory. The rescore manifest records the judge configuration, current
source hashes, and whether scenario inputs, fixtures, prompt, and evaluator
still match the original bundle. The eval viewer exposes every version rather
than silently replacing an earlier score.

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

Define scenarios with `defineAgentEvalScenario()` under
`src/evals/suites/behavior/` or `src/evals/suites/realbook/`. Pick the group by
the scenario's identity: capability-first → behavior; book-first → realbook.
Real-book reader-style questions should use the `bookQuestion()` factory
(`suites/realbook/question-factories.ts`) — it wires cursor construction,
digest seeding, language checks, fence/no-fence red lines, and leak-word
assertions uniformly; you supply the question, the verified assertion words,
and the rubric. Tag it from the closed vocabulary in `src/evals/tags.ts`
(capability + modifier + book slug where relevant) — `suites.test.ts` rejects
out-of-vocabulary tags. Keep fixture books synthetic and make expected facts
explicit. Prefer:

1. A deterministic answer or state invariant.
2. A trajectory invariant explaining how the answer was obtained.
3. A serializable `criteria` field for every custom check.
4. Optionally a `rubric` for judge-scored quality dimensions — each entry one
   decidable statement, phrased so a grader can score it from the transcript
   alone.

When a scenario asserts that a capability EXISTS, consider whether a `control`
twin (assertions inverted) is meaningful — personalization's no-profile twins
are the pattern; a capability that passes its control was never being tested.

Use `setup` only for domain seams the fixture cannot express, such as a declined
permission or a scope-filtered plugin tool. Use `observeState` to expose the
smallest post-run projection needed for scoring; never serialize an entire
credential-bearing runtime object.
