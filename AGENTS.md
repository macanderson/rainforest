# AGENTS.md — guidance for the autonomous builder

This file is read natively by Stella (and any other autonomous agent) at session
start. It is the operating contract for building Rainforest. Follow it exactly.
Where this file and an issue body conflict, the issue body wins for scope; this
file wins for process.

Rainforest is a proving ground: the app you are building is a fictional
enterprise demo, **and the act of building it is itself an experiment** in
autonomous delivery. Both halves matter. See `README.md` for the premise and
`RAINFOREST.md` for the business fiction.

---

## 1. Issue workflow

1. **Pick only issues labeled `status:ready`.** Never pick `status:blocked`
   issues. There is no class of issue reserved for a person: every step in
   this repo's process is performed by an agent.
2. **Respect blocker lines.** Dependencies are encoded as a literal,
   machine-greppable line in the issue body:

   ```
   Blocked by: #N
   ```

   An issue is ready only when **every** issue referenced by its `Blocked by:`
   lines is closed. Check this yourself before starting work — labels can lag
   reality. If you find a `status:ready` issue with an open blocker, fix the
   label to `status:blocked` and pick something else.
3. **One issue = one PR.** Every PR references exactly one issue (`Refs #N` in
   the PR body; use `Closes #N` only when the acceptance checklist is fully
   met). Never bundle multiple issues into one PR, and never open a PR with no
   issue behind it.
4. **Epics are tracking issues.** Work happens in their sub-issues, never
   directly against an issue labeled `epic`.
5. When you close out an issue, tick its acceptance checklist items in the
   issue body and update the parent epic's checklist.

## 2. Definition of done

A PR is not done until **all** of the following hold:

- [ ] Typecheck passes (`pnpm typecheck` or the repo's equivalent once scaffolded).
- [ ] Lint passes with zero warnings.
- [ ] Unit tests pass; new logic ships with new tests.
- [ ] **`pnpm reconcile` is green whenever data is touched** — any change under
      `data/`, any seed generator, any migration, any job that mutates seeded
      rows. Reconciliation drift against `data/numbers-bible.json` (±2%) is a
      CI-blocking defect, never a "known issue".
- [ ] **UI issues require a screenshot committed on the PR** showing the built
      surface in its populated state. No screenshot, no merge.
- [ ] The issue's own acceptance checklist is satisfied item by item.

## 3. Branch and PR conventions

- Branch from a fresh, synced `main`. Never commit or push directly to `main`.
- Branch names: `issue-<N>-<short-slug>` (e.g. `issue-14-orders-console`).
- Commit messages: conventional-commit style (`feat:`, `fix:`, `chore:`,
  `docs:`, `test:`) with the issue number in the body or subject.
- Commit and push frequently; a pushed work-in-progress branch beats a perfect
  local one.
- PR title mirrors the issue title. PR body: issue reference, what changed,
  DoD checklist (§2), screenshot slot for UI work.
- **One issue = one PR, and the PR merges itself.** Enable auto-merge when you
  open the PR (`gh pr merge --auto <N>`); it merges the moment CI is green.
  There is no human review gate and no human merge authority — CI is the
  reviewer. If CI is red, fix it on the branch; never bypass it.
  - GitHub only auto-merges when `main` carries a required check; that
    protection is part of the CI pipeline issue (#25). Until #25 lands, the
    agent that opened the PR merges it itself once the §2 checklist passes
    (`gh pr merge --squash <N>`) — still no person in the loop.

## 4. The palette rule — this is law

The entire product is **black, white, and red. Nothing else.**

- Pure black `#000` and pure white `#fff` for the base planes.
- The red scale `#7f1d1d → #fca5a5` for alerts, CTAs, and accents only.
- A grey scale for chrome and neutrals.
- **No other hue may appear anywhere** — not in a chart, not in a favicon, not
  in a hover state, not in a third-party component's defaults. A lint rule
  enforces the token sheet; if you find a hue that slipped past it, that is a
  defect to fix immediately.

Red is scarce on purpose: it must always mean "look here" (an alert, a CTA, a
late shipment). If red is everywhere it means nothing.

## 5. Goal-A proof hooks — read carefully

This build doubles as the live integration test for Stella's self-improvement
capabilities. Three behaviors are part of the experiment, not accidents:

1. **When you notice yourself repeating a command shape, that is expected —
   the tool foundry watches.** Repeated seed/CSV/sqlite inspection commands are
   supposed to trip gap detection during epic E3. Do not suppress the
   repetition, do not hand-roll a wrapper script to hide it, and do not treat
   the gap-detection notice as noise. The foundry then builds and equips the
   tool **autonomously** — detected gaps are authored, validated under
   network denial, adopted, and enabled by Stella itself (Stella ADR 0023).
   There is no adoption step for anyone to perform, and you must not perform
   one by hand: never run `stella tools --adopt` / `--enable`, and never
   write a tool into `.stella/tools/` yourself. Safety is the standing
   controls — network denial, versioned rollback, per-launch telemetry, the
   circuit breaker — not a reviewer.
2. **Never disable or edit `stella.toml` or anything under `.stella/`.** The
   `[foundry]` block in `stella.toml` at the repo root is deliberately tuned
   for this experiment (see the file's comments). Changing it, deleting it, or
   working around it invalidates the proof run. If a threshold seems wrong,
   say so in a `triage` issue — do not touch the file.
3. **Skills mined from this build are part of the experiment.** Reflections,
   mined skills under `.stella/skills/`, promotions, appraisals, and demotions
   generated while building Rainforest are proof artifacts. Do not prune,
   hand-edit, or "clean up" mined skills; their lifecycle is being measured.

## 6. The `proofs/` directory

`proofs/` holds the Goal-A evidence checklists (RF-P1..P4). **Never touch
`proofs/` except to append evidence** — transcript excerpts, ledger rows,
adoption records, reconciliation reports — under the checklist item it
satisfies. Never rewrite, reorder, or delete existing content there.

## 7. Residue

Anything you notice that is out of scope for the issue in hand — a follow-up, a
tech-debt item, a spec gap, a logical next step — becomes a **new issue labeled
`triage`**, filed before you declare the current issue done. Apply only the
`triage` label; never apply priority or size labels (a separate triage process
owns those).

## 8. Ground rules recap

- Locked canonical facts live in `RAINFOREST.md` and
  `data/numbers-bible.json`. Cite them; never restate figures independently and
  never invent or alter a named entity, date, or figure.
- This repo's fiction never names real companies or people as actors or
  competitors.
- No secrets in the repo, ever. Deployment secrets live on the host, placed
  there by the provisioning script (E7#2, #18); nothing in this repo waits on
  a person to enter one.
- When in doubt about scope: do what the issue says, file residue for the rest.
