## Issue

<!-- Exactly one issue. `Refs #N` while work is in flight; `Closes #N` only
     when the issue's acceptance checklist is fully met. One issue = one PR. -->

Refs #

## What changed

<!-- A short, factual summary of what this PR does. -->

## Definition of done

<!-- All boxes must be checked before merge. See AGENTS.md §2. -->

- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Lint passes with zero warnings (`npm run lint`)
- [ ] Unit tests pass (`npm test`); new logic ships with new tests
- [ ] `pnpm reconcile` is green (required whenever data is touched: `data/`,
      seed generators, migrations, jobs that mutate seeded rows; otherwise N/A)
- [ ] The issue's acceptance checklist is satisfied item by item

## Screenshot

<!-- Required for any UI change: the built surface in its populated state.
     No screenshot, no merge. Delete this section for non-UI PRs. -->
