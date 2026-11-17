# Agent Evaluations

ReadAware separates deterministic runtime tests from live, model-backed behavior
evaluations. `bun test` remains the hard correctness gate. The eval runner calls
the real `AgentThread` and records what the model actually saw and did.

## Environment

Evals run on the app's **headless host** (`apps/web/tests/headless`), started by
`apps/web/scripts/agent-evals.ts` — every `eval:*` run command goes through it.

- The books of the real-book suites are files in a headless shell's library.
  Above the native boundary (`platform/ipc`) the code is the app's own: the
  reader engine parses the EPUB, `extractBookText` cuts chapters and builds the
  block and sentence tables, and the agent's `bookText` port is
  `createBookTextPort`, the one the desktop agent uses (search, exact locations,
  ranges, navigation, locating a reader position). The shell stands in for the
  native side only: an in-memory library, blob store and book archive. A native
  command it does not provide fails by name.
- A turn's reading position is handed to the runtime as the reader reports it:
  locations in the book (real CFIs, one per source document on screen), the
  chapter's href and the viewport text through the app's own sampler. The
  runtime resolves chapter and coordinates itself.
- Scenarios are written against each book's **snapshot**
  (`fixtures/<slug>.booktext.json`): the chapters, titles, text and coordinates
  the app extracts. Every run first compares the snapshots with a fresh
  extraction and stops when they differ; `bun run eval:snapshots` rewrites them.
  `tests/agent-reading-context.test.ts` holds the same check, and the
  `eval-book-parity` runtime suite repeats the extraction in a browser engine.
- **Not on the host yet:** the business store. Annotations, memory,
  conversations, settings and the reader session are the in-memory ports of
  `src/testing`. The suites over a few seeded lines of text (`behavior`) have
  no book file and run entirely on those ports; each run records which
  environment it used (`app-headless` or `in-memory`).

A model-free layer sits below the model runs:
`apps/web/tests/agent-reading-context.test.ts` drives the same host with a
scripted model and checks what a model is shown and what the reading tool
returns for a real position in a real book. A failure there is a failure of the
app's pipeline, whatever a model would have made of it.

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
  it never changes once published. 17 suites; scenario counts come from the registry.
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

`smoke` (modifier) marks the small representative set to run first after any
agent change: `bun run eval:smoke` (about a dozen scenarios, a few minutes).

Filter scenarios by tag across a suite or a whole group:

```sh
bun run eval:agent behavior --tag spoiler,permission
bun run eval:agent realbook --tag control
```

Tag rollups are first-class outputs: every report gains a `## Diagnostic tags` section,
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
  surfaces: style (length checks diagnose an explicit concision preference),
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
- `shelf` (S19): shelf management by what the files allow. Removing entries
  whose file can no longer be fetched while keeping books that are on the
  device, still held by sync, or virtual; refusing to remove anything when the
  sync backend cannot be asked; pointing out an unopenable entry that shares a
  file with one that opens; starring several books in one call; and finding
  books by condition. File states come from the scenario's `setup`, standing in
  for the sync backend behind `check_book_files`.
- `tools` (S17): shelf presentation, humane reading stats, trajectory economy
  (batched search variants, targeted chapter reads), no-false-success on
  missing books, presentation restraint, and plugin tool scope exposure.
- `search` (S18): BYOK web retrieval with isolated provider fixtures and real
  AgentThread/model calls: search → original page → citation, direct live URL
  fetch, stable explanations without browsing, empty results, provider errors,
  disabled search, malicious page instructions, and private-query minimization.
  Run `bun run eval:agent search --repetitions 1`; review answers as well
  as trace checks. This suite does not test live TinyFish or native transport;
  use the desktop AI settings connection test and a real chat for that boundary.
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

### realbook — one suite per book

Every suite has a stable machine `id` and a human-readable `displayName` used
by the viewer. Real-book suites are organized only by book title; there is no
standalone aggregate suite.

Each per-book suite has three layers: **hand-written core scenarios** (the
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
off-shelf recommendations (framed as world knowledge, never fake cards), plus
the **generated common scenarios** from `real-book-common.ts` for topical
lookup, selected-passage explanation, verbatim annotation, chapter-crossing
recall, no-cursor policy, and quote location. The generated scenarios are
appended to that book's own suite instead of forming a separate `realbooks`
suite.
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
  trilogy omnibus (`fixtures/santi.epub`, 57 chapters / ~900k chars; the app rebuilds its navigation). What
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
  (`fixtures/lebon.epub`, 21 chapters). The counterpart surface to the
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
  (`fixtures/berger.epub`, 9 chapters). The tool-book angle: the reader
  brings a real situation and the answer must APPLY the finished chapters'
  methods to it — explaining the methods AND coaching with them (turning them
  into usable questions for the reader's actual stakes) — plus an honest
  finish/don't-finish recommendation for a reader with a stated background,
  and zero-ceremony forward peeks at later chapters. The question bank adds
  multi-situation coaching (retrospective meetings, parenting, team
  creativity), the too-idealistic pushback conversation, and the
  same-intent-three-wordings invariance run.
- `refactoring` (S14): technical real book — the full English Refactoring 2nd
  ed (`fixtures/refactoring.epub`, 24 chapters / ~730k chars, images stripped
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

**Evals run on DeepSeek's own API** (`EVAL_DEFAULT_PROVIDER` in
`evals/model-config.ts`): provider `deepseek`, model `deepseek-flash`, the one
flash id the official API serves (a rolling id; DeepSeek V4.1 Flash on
2026-11-16). The key is `DEEPSEEK_API_KEY` or the `deepseek` entry of the Pi
CLI credentials in `~/.pi/agent/auth.json`. The eval runner, `eval:digests`
and `eval:classify` share this default, so a baseline and the fixtures it
reads come from one model. Baselines are always taken on this configuration.

Check the account before a long run (`GET https://api.deepseek.com/user/balance`).
A provider that runs out of credit does more than fail runs: when the answer
check's rewrite call is refused, the runtime falls back to its refusal line,
and the sample looks like agent behavior. After a run, look for provider
errors before starting the next suite.

**OpenRouter** (`--provider openrouter`) remains available for comparisons:
default model `deepseek/deepseek-v4-flash-0731` (the undated slug is the stale
0423 snapshot, not a rolling alias), key `OPENROUTER_API_KEY` or the
`openrouter` entry in `~/.pi/agent/auth.json`. Every eval-side OpenRouter
request carries a routing preference — Baidu (Qianfan) first, CoreWeave
second, fallbacks allowed (`applyEvalRouting`); this preference is eval-only
and never leaks into the product, where OpenRouter users own their account
routing. That snapshot is not the model `deepseek-flash` serves, so OpenRouter
runs are a different condition from a baseline and are never merged into one.

**Ollama Cloud** (`--provider ollama-cloud`) talks to ollama.com's hosted
OpenAI-compatible API (`https://ollama.com/v1`, key `OLLAMA_API_KEY` or the
`ollama-cloud` entry in `~/.pi/agent/auth.json`, made at
https://ollama.com/settings/keys). Default model `deepseek-v4-flash:0731` —
the same model/snapshot as the one pinned for OpenRouter on a different host,
so runs on those two hosts stay comparable with each other. It rides the same custom
OpenAI-completions adapter as `custom`, with a curated cloud catalog from
`/v1/models` (see `models/ollama-cloud.ts`); Ollama retires old cloud models,
so the default may need bumping.

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

# One capability group (12 suites), or the real-book group (5 suites)
bun run eval:behavior
bun run eval:agent realbook --repetitions 3

# Everything, group by group (behavior first, then realbook)
bun run eval:all --repetitions 3 --concurrency 4

# One capability axis across all capability suites
bun run eval:agent behavior --tag spoiler

# One scenario (run first, then review the saved evidence before acceptance)
bun run eval:reading --scenario narrative-no-spoiler --repetitions 3

# Compare two models with paired scenario/repetition runs
bun run eval:reading \
  --candidate-model deepseek-v4-pro \
  --repetitions 5

# Cross-provider comparison (paired per scenario/repetition)
bun run eval:agent reading \
  --candidate candidate-openai=openai:gpt-5.6-sol \
  --repetitions 5

# Real-book suite across two providers
bun run eval:agent karamazov \
  --candidate glm=zai-coding-cn:glm-5.2 \
  --judge \
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

## Semantic Review Is The Quality Verdict

Evaluation follows the task, not the suite or conversation scope. Reading and content
interpretation (including web/image answers), and mixed content/action tasks default
to `input.evaluation = "semantic"`: the primary agent compares original sources,
complete answers, tools and actual state before saving an evidence-backed review.
Assertions are diagnostics, not semantic acceptance. Automatic judges are preliminary.

Pure deterministic actions may explicitly set `evaluation: "programmatic"` in
`defineAgentEvalScenario`. A completed output and actual `state` checks are required;
then the assessment determines acceptance. Validate target scope, side effects,
authorization and receipts, not just tool names or success phrases. Settings updates
are examples. A failing contract cannot be overridden with a passing prose review.
Unmarked legacy runs remain semantic/pending. An explicit reasoned review may still
reject a programmatic pass. `summary.quality` reports pass/partial/fail/pending/error
using this same policy in the CLI and Viewer. Scoring/judge errors do not erase
completed answers; interrupted execution cannot be rescued by a review.

The primary agent reads structured local artifacts directly, without browsing
the Viewer. The Viewer is the user's presentation and discussion surface.
Missing evidence is a logging gap to fix, not a reason to substitute screenshots.
Reviews use the existing `human-reviews.json` companion shared with the Viewer. A
verdict needs a nonempty evidence-based comment; scores alone do not close
review. Every sample in the claimed acceptance scope must be read. Large runs
may be reviewed in batches but unreviewed coverage remains explicit. The
primary agent should first read evidence without the assertion score, then
compare diagnostics and attribute discrepancies to product / assertion /
fixture / judge / environment. Record at least one off-syllabus question for
changed product behavior; tooling changes can instead validate against retained
raw transcripts. See `.agents/skills/evals/SKILL.md` for the complete workflow.

```sh
bun run eval:agent reading --scenario printed-chapter-after-frontmatter
bun run eval:review .eval/<run-id> --list
bun run eval:review .eval/<run-id> --case 'run:<record-id>'
# After reading evidence, compare optional diagnostic checks/model opinion.
bun run eval:review .eval/<run-id> --case 'run:<record-id>' --diagnostics
bun run eval:review .eval/<run-id> --save /tmp/reviews.json --gate
```

`eval:review` performs no inference. It rebuilds summary/report from immutable
runs plus reviews; pending, partial, failed, erroneous or incomplete planned
samples and non-passing freeform follow-ups fail the gate. Viewer saves update
the same report. User reviews and main-agent reviews share this format.
`--save` takes one review object or an array and merges only those targets.
Reviews can attach `findings` with product/assertion/fixture/judge/environment
attribution, evidence paths and explanations. See the skill's
[structured review reference](../../.claude/skills/evals/references/reviewing.md).

### Optional Automated Opinion

`--judge` adds an evidence-aware initial opinion on every scenario, stored in
`assessment.modelReview`, **separate** from diagnostic checks and primary
review. It is not a release verdict and does not certify the tested model by
letting it grade itself. Choose a different model when independence matters.

The judge receives the recorded scenario, full conversation, selections/cursors,
full tool arguments and results, interaction responses, actual state, original
chapter labels and touched fixture text. It excludes model hidden reasoning and
request credentials. Missing source material must be identified as uncertainty;
retrieval indexes must not be converted to printed chapter numbers. Source
omissions are explicit; an oversized judge prompt fails instead of silently
truncating answers. Invalid JSON retries once, then becomes a scoring error.
Criterion scores >= 0.8 suggest pass; weak or contradicted evidence produces a
partial/fail opinion with a specific rationale, never a blended quality score.

```sh
bun run eval:agent reading --judge --judge-provider openai --judge-model gpt-5.6-sol
bun run eval:rescore .eval/<run-id> --judge
```

## Artifacts

Every invocation creates an ignored `.eval/<run-id>/` bundle:

```text
manifest.json             run configuration, model/judge metadata, git revision,
                          and SHA-256 prompt/evaluator/runtime/fixture provenance
runs.jsonl                one normalized record per attempted run
runs/<variant>/<case>/    full model-visible context, chunks, tools, answer
  <repetition>.review.json agent-facing evidence: complete answers, parsed tool
                          receipts, source snapshots and state; no hidden reasoning
summary.json              primary review coverage + diagnostic aggregate/comparison data
report.md                 review-first summary (refresh after editing reviews)
human-reviews.json         local primary verdicts, dimensions, notes, attributed findings
review-summary.json       primary acceptance + freeform coverage (eval:review)
manual-sessions.json       freeform reader questions, follow-ups, answers, tools, telemetry
```

Execution errors can retain an optional `partialOutput` snapshot with captured
chunks, tool receipts and model requests up to interruption. It is diagnostic
evidence, separate from a completed `output`, and is never graded or rescored.
Active requests may have no completed-round timing or token usage yet; inspect
the captured activity before interpreting zero-valued completion telemetry.

Users can browse everything in the **eval viewer** (`bun run eval:ui`, port 5199 —
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
baseline's per-scenario diagnostic pass rate and check score (plus per-scenario tags and a
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

Assertions diagnose outcomes and traces: phrases, tools, errors, interactions,
state changes, rounds and custom context invariants. Exact execution / permission /
state contracts remain deterministic tests; semantic correctness belongs to
source-based review. Do not weaken a contract to hide a product defect.

Execution/setup/timeout/scoring errors fail the command. `eval:agent --gate`
also requires primary reviews for semantic tasks, so those fresh runs exit nonzero while
pending. Finish review and use `eval:review <bundle> --gate` for acceptance.
`eval:rescore --gate` also consults existing primary reviews. CI runtime contracts
use `bun test`; an unreviewed model pass rate is not a CI quality gate.

`eval:classify` records original classification inputs and outcomes for the same
review process; comparison to the registry is diagnostic. `eval:digests` is a
fixture generator, not a semantic acceptance test: generated JSON needs source
review before it becomes a trusted fixture.

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

1. A reader task, verifiable expected facts, and scenario-specific semantic
   criteria. The shared four-dimension rubric is always included.
2. Original source evidence and exact chapter/volume labels, reading boundary,
   approvals, and minimal before/after state needed to judge the outcome.
3. Useful deterministic diagnostics, with serializable `criteria` for custom
   checks. Keywords are clues, never the semantic truth oracle.

When a scenario asserts that a capability EXISTS, consider whether a `control`
twin (assertions inverted) is meaningful — personalization's no-profile twins
are the pattern; a capability that passes its control was never being tested.

Use `setup` only for domain seams the fixture cannot express, such as a declined
permission or a scope-filtered plugin tool. Use `observeState` to expose the
smallest before/after projection needed to judge each turn; never serialize an entire
credential-bearing runtime object.
