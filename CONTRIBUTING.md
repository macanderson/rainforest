# Contributing to Rainforest

Rainforest is a proving ground: the app is a fictional enterprise demo, **and
the act of building it is itself an experiment** in autonomous delivery (see
`README.md` for the premise). Every contribution — human or agent — follows
the same contract. That contract is defined in [`AGENTS.md`](AGENTS.md); this
file restates it for contributors and never overrides it. Where the two
appear to disagree, `AGENTS.md` wins for process and the issue body wins for
scope.

## Issue workflow

All work flows through GitHub issues. The full rules are `AGENTS.md` §1; the
short version:

1. **Pick only issues labeled `status:ready`.** Never pick `status:blocked`.
2. **Respect `Blocked by:` lines.** Dependencies are a literal,
   machine-greppable line in the issue body (`Blocked by: #N`). An issue is
   ready only when every referenced blocker is closed — check before
   starting, because labels can lag reality.
3. **One issue = one PR.** Every PR references exactly one issue
   (`Refs #N`; `Closes #N` only when the acceptance checklist is fully met).
   Never bundle issues, never open a PR with no issue behind it.
4. **Epics are tracking issues.** Work happens in their sub-issues, never
   directly against an issue labeled `epic`.
5. When closing an issue, tick its acceptance checklist and update the parent
   epic's checklist.

File new work with the issue forms under `.github/ISSUE_TEMPLATE/` (Feature
or Epic). Anything noticed that is out of scope for the issue in hand becomes
a new issue labeled `triage` — never apply priority or size labels yourself
(`AGENTS.md` §7).

## Branch and PR conventions

Per `AGENTS.md` §3:

- Branch from a fresh, synced `main`. Never commit or push directly to
  `main`.
- Branch names: `issue-<N>-<short-slug>` (e.g. `issue-14-orders-console`).
- Commit messages: conventional-commit style (`feat:`, `fix:`, `chore:`,
  `docs:`, `test:`) with the issue number in the body or subject.
- Commit and push frequently; a pushed work-in-progress branch beats a
  perfect local one.
- PR title mirrors the issue title. The PR template enforces the required
  body: issue reference, what changed, the DoD checklist, and a screenshot
  slot for UI work.
- **The PR merges itself.** Enable auto-merge when opening the PR
  (`gh pr merge --auto <N>`); CI is the reviewer — there is no human review
  gate. If CI is red, fix it on the branch; never bypass it.

## Definition of done

A PR is not done until **all** of `AGENTS.md` §2 holds:

- [ ] Typecheck passes (`npm run typecheck`).
- [ ] Lint passes with zero warnings (`npm run lint`).
- [ ] Unit tests pass (`npm test`); new logic ships with new tests.
- [ ] **`pnpm reconcile` is green whenever data is touched** — any change
      under `data/`, any seed generator, any migration, any job that mutates
      seeded rows. (The reconcile script lands with the seed-data epic; until
      then this item is N/A.)
- [ ] **UI issues require a screenshot committed on the PR** showing the
      built surface in its populated state. No screenshot, no merge.
- [ ] The issue's own acceptance checklist is satisfied item by item.

## Ground rules

- The palette is law: black, white, and red only (`AGENTS.md` §4). A lint
  rule enforces the token sheet.
- Canonical facts live in `RAINFOREST.md` and `data/numbers-bible.json` —
  cite them, never restate or invent figures.
- Never touch `stella.toml`, `.stella/`, or `proofs/` (except to append
  evidence under a checklist item) — see `AGENTS.md` §5–6.
- No secrets in the repo, ever.
