# proofs/ — Goal A proof artifacts

This directory collects the evidence that Stella's self-improvement capabilities worked during this build. Agents append evidence files (`tool-foundry.md`, `skill-mining.md`, `skill-functions.md`, `delivery.md`) but never rewrite history — existing evidence is append-only, exactly like the ledgers it mirrors.

The proof procedures and observable-evidence checklists below are carried verbatim from §3 of the master action plan ("Goal A — no-gaps proof test plan").

---

Principle: every capability gets (1) an automated **witness test** in Stella extending an existing pattern, and (2) a **live proof event** during the Rainforest build with named observable artifacts. A capability is proven only when both exist. All Rainforest-build evidence is collected under a `proofs/` directory in the rainforest repo (committed — it's a public demonstration, that's the point) plus Stella-side ledgers.

## RF-P1 — Custom tool building (foundry), end to end

Requires A1–A4 landed.

Proof procedure:
1. Rainforest `.stella/` config sets gap-detection thresholds low (A2) so repeated seed/CSV/sqlite inspection command shapes trip detection early in epic E3.
2. During the build, Stella's end-of-turn hook (A1) writes ≥1 gap to `.stella/private/tool_gaps.jsonl`.
3. Human runs `stella tools draft <gap-id>` (A3) → manifest+script in `.stella/tools/proposed/`.
4. Human runs the existing adopt flow → `foundry_gate.rs` re-digests manifest+script per call; tool enabled.
5. Stella uses the adopted tool in ≥3 subsequent turns of the same epic, including at least one invocation whose script contains a shell redirect (A4 regression, live).

Observable evidence (no-gaps checklist):
- [ ] gap ledger row with timestamp + command-shape fingerprint
- [ ] `proposed/` pair with digests recorded at adoption
- [ ] adoption record (adopt.rs output) committed to `proofs/tool-foundry.md`
- [ ] session transcript excerpts showing ≥3 executions through the gate
- [ ] evolution ledger rows for A1–A4, ratchet still 0

Automated witness tests: extend `foundry_gate.rs` witness pattern; promote the replay-module `detect_tool_gaps` exercise from `#[cfg(test)]`-only into an integration test that drives the *live* hook path (synthetic session history → ledger row), not the function in isolation — that is the exact gap being closed.

## RF-P2 — Skill mining, promotion with lift, and demotion

Requires A5–A7 landed.

Proof procedure:
1. During epics E2–E3, Stella's reflections (`.stella/private/reflections.jsonl`) accumulate; the inline end-of-turn miner (already live, `learning.rs:381`) mines ≥1 skill from Rainforest-build reflections (expected shape: "run `pnpm reconcile` before committing seed-generator changes").
2. The mined skill is **selected** by `select_skills` in a later session and observably applied (transcript shows the behavior).
3. Promotion record carries `MeasuredLift` evidence (A6) — before/after outcome delta on reconcile-adjacent tasks.
4. Demotion: plant one deliberately harmful skill (e.g., "always regenerate all seed data on any schema change" — measurably wasteful); let outcomes accrue ≥3 negative appraisals; assert `skill_appraisals.jsonl` rows exist and the skill is demoted and no longer selected.

Observable evidence:
- [ ] reflections rows → mined skill file under `.stella/skills/` (append-only ledger row; DB triggers verified blocking UPDATE/DELETE)
- [ ] `select_skills` trace showing selection in a later session
- [ ] promotion record with lift evidence
- [ ] `skill_appraisals.jsonl` with ≥3 negative rows for the planted skill + demotion row + subsequent non-selection trace
- [ ] all committed to `proofs/skill-mining.md`

Automated witness tests: A7's e2e test (copy `guarantees.rs:825` twin structure) covering mine→write→load→select and promote→demote→exclude.

## RF-P3 — Skill functions (invoke directives)

Requires A8 landed.

Proof procedure:
1. Author (human or Stella) a skill `generate-quarter-seed` in the rainforest repo's `.stella/skills/` carrying invoke directives: `context: fork`, `allowed-tools: [bash, read, write]` (no network/gh), pinned `model`/`effort`.
2. Invoke it both ways: (a) `stella skill run generate-quarter-seed -- --quarter 2025-Q3`; (b) in-session directive expansion when the skill is selected during E3 work.
3. Demonstrate grant narrowing: inside the fork, an attempted disallowed tool call is denied by the `skill_grant.rs` intersection — captured in transcript.

Observable evidence:
- [ ] skill file with directives, parsed (no parser errors) — `invoke.rs:108` path
- [ ] fork-session transcript showing narrowed tool set + one denial
- [ ] seed artifacts produced by the fork, reconciliation green
- [ ] `active_skill_slugs()` returning the real slug set (log line), stub gone
- [ ] committed to `proofs/skill-functions.md`

Automated witness tests: directive parse table test; grant-intersection property test (already partially exists in `skill_grant.rs` — extend with fork-execution denial witness); CLI verb integration test.

## RF-P4 — Autonomous delivery (the meta-proof)

Requires A9 (or the documented degraded mode).

- **Full mode:** Stella's delivery verb works the Rainforest backlog: for each ready issue — branch, implement, PR referencing the issue, CI green, human merge. Target: ≥80% of the 45 issues closed via Stella PRs; autonomy ledger rows per cycle.
- **Degraded mode (explicit fallback if A9 slips):** human launches one Stella session per issue with the issue body as the prompt; everything else identical. State which mode was used in `proofs/delivery.md` — do not blur them.

## 3.4 Phase gate

| Phase | Content | Gate |
|---|---|---|
| P0 | Stella work: A1–A8 (A9 best-effort) + witness tests | Rainforest E1–E2 may proceed in degraded mode without P0; **E3+ must not start until A1–A8 are merged**, because E3 is where RF-P1/P2/P3 proofs are staged |
| P1 | Rainforest build E1→E8 by Stella | Each epic's closing checklist includes any proof events assigned to it |
| P2 | Proof audit | All RF-P1..P4 checklists fully checked; `proofs/` committed; evolution ratchet 0 |
