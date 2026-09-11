# Desktop Acceptance

These modules are test drivers and Worker probes, not installable plugins and
not part of the application source tree. The 107 original modules were moved
here together; their source imports and Worker URLs retain their original
targets. Historical JSON evidence retains the paths used when it was recorded.

## Stage One Checks

From the repository root:

```sh
bun run --filter @read-aware/web typecheck:desktop
bun run --filter @read-aware/web test:desktop-contracts
```

The normal workspace typecheck includes this directory through its own tsconfig.
The contract tests validate module paths, prohibit production dependencies on
these drivers, and run the existing real Bun Worker protocol suite. They do not
start Tauri, prove native storage behavior, or count as plugin E2E acceptance.

## Stage Three Execution

Use only the isolated Tauri configuration at
`apps/desktop/src-tauri/tauri.capability-e2e.conf.json`. Driver imports from that
application's dev server now start with `/tests/desktop/`, for example
`/tests/desktop/desktop-selection-probe.ts`. Do not use the normal application or
its data directory. Each driver retains its isolation checks and explicit cleanup
entrypoints; preparation, observations, assertions and cleanup must all be
recorded. A cleanup failure is a failed round, not a successful test.

These existing probes are reusable building blocks, not the final plugin-round
runner. Stage two must map real installable plugin workflows to matrix rows;
stage three must run the complete mapped workflow with failure, concurrency,
cancellation and revocation paths and persist evidence. Old probe evidence does
not close that new acceptance requirement.
