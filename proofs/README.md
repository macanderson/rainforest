# proofs/ — Goal A proof artifacts

This directory collects the evidence that Stella's self-improvement capabilities worked during this build. Agents append evidence files (`tool-foundry.md`, `skill-mining.md`, `skill-functions.md`, `delivery.md`) but never rewrite history — existing evidence is append-only, exactly like the ledgers it mirrors.

The proof procedures and observable-evidence checklists below derive from §3 of the master action plan ("Goal A — no-gaps proof test plan"), revised on 2026-08-30 to match the capabilities as they actually shipped in Stella (main `5f1de6a6a`: macanderson/stella#5476, #5468, #5467). The governing rule from the repository owner: **no human step anywhere.** Every procedure below is performed by Stella itself or by the orchestrating agent that drives Stella; nothing waits on a person, and an evidence artifact that records a person performing a step falsifies the proof it belongs to.

---

Principle: every capability gets (1) an automated **witness test** in Stella extending an existing pattern, and (2) a **live proof event** during the Rainforest build with named observable artifacts. A capability is proven only when both exist. All Rainforest-build evidence is collected under a `proofs/` directory in the rainforest repo (committed — it's a public demonstration, that's the point) plus Stella-side ledgers.

## RF-P1 — Custom tool building (foundry), end to end, autonomous

Requires A1–A4 landed — merged in macanderson/stella#5476 (Stella ADR 0023, "autonomous tool foundry").

The foundry runs with no human in the loop. What replaces the human is a set of standing controls, each enforced where it cannot be skipped: OS-level network denial at spawn for every foundry-built tool, an append-only version history with rollback, a telemetry row per launch, and a circuit breaker that auto-disables a failing tool. This repo's `stella.toml` sets the `[foundry]` block to fire early (`min_occurrences = 2`, `min_reuse_ratio = 1.0`) with `autonomy = "auto"` and the shipped breaker defaults.

Proof procedure:
1. **Gap auto-detected.** During epic E3, Stella's end-of-turn hook (A1) reads recent `bash` history out of `.stella/private/store.db` and appends ≥1 row to `.stella/private/tool_gaps.jsonl` (`gap_id`, `name`, `signature`, `command_template`, `parameters`, `occurrences`, `distinct_arguments`, `examples`, `detected_at`) under the lowered A2 thresholds, and prints a one-line notice.
2. **Auto-authored.** In the same hook, under `foundry.autonomy = "auto"`, the gap is rendered into a manifest+script pair under `.stella/tools/proposed/` (A3). Nobody runs a draft verb; `stella tools --draft <gap-id>` exists only as the manual escape hatch and is not part of this proof.
3. **Validated with network denial.** Manifest re-parse, static script lint, and the capability witness's two executions — run wrapped by Stella's `netdeny` (macOS `sandbox-exec`, Linux `unshare -r -n`) — are the sandboxed dry-run. On a host with no working isolation Stella degrades itself to draft-only and the proof **cannot** complete there; the evidence must show the adoption notice and the absence of a "degraded to draft-only" notice.
4. **Auto-adopted, auto-enabled.** Digests recorded in the store's `foundry_tools` ledger, a version row with the exact bytes appended to `foundry_tool_versions`, enabled bit set. The tool is discoverable from the next turn on, through the foundry gate — whose per-call re-digest is unchanged and remains the tamper check.
5. **Executes ≥3×.** Stella uses the adopted tool in ≥3 subsequent turns of the same epic, including at least one whose script carries a shell redirect (`>`, `>>`, `2>&1`, `|`) — the A4 regression (macanderson/stella#5385), live. Every launch writes a `foundry_invocations` row.
6. **A forced failure trips the breaker.** The orchestrating agent (never a person) invokes the tool with an input that makes the script exit non-zero, `breaker_consecutive_failures` (3) times. The breaker records `foundry_tools.disabled_reason`, the gate reports the tool `Disabled`, `stella tools --status` shows it, and the next launch is refused before any process spawns.
7. **Rollback restores the prior version.** `stella tools --rollback <name>` (run by Stella or the orchestrating agent) restores the previous version's exact bytes from `foundry_tool_versions`, re-digests, re-enables, and the gate registers the tool again. The version history has grown — never shrunk.

Observable evidence (no-gaps checklist):
- [ ] gap ledger row(s) from `.stella/private/tool_gaps.jsonl` — `gap_id`, `signature`, `occurrences`, `detected_at`
- [ ] the end-of-turn notice lines (gap detected → tool adopted), and no "degraded to draft-only" notice
- [ ] adoption rows: `foundry_tools` (manifest + script digests, `enabled`) and the `foundry_tool_versions` row — from `stella tools --status` / `stella tools --foundry`, or `sqlite3 .stella/private/store.db`
- [ ] the adopted manifest + script (`.stella/tools/<name>.toml` and its script), quoted, with the redirect operators byte-exact
- [ ] ≥3 `foundry_invocations` rows (tool, script digest, `gap_id` lineage, duration, exit, timeout, output bytes) — at least one from the redirect-carrying invocation
- [ ] breaker event: the `disabled_reason` row, the `[circuit breaker]` notice, and the refused launch
- [ ] rollback event: `--rollback` output, the restored version's digests, `--status` showing the tool enabled again with the breaker verdict cleared
- [ ] evolution ledger rows for A1–A4 present, ratchet still 0
- There is **no** human adoption record. `stella tools --adopt` / `--enable` must not appear anywhere in the evidence.

Automated witness tests (landed with macanderson/stella#5476): `a_synthetic_gap_is_autonomously_adopted_and_its_network_call_is_denied` (the live end-of-turn path, with a real TCP connect denied at witness time and run time), `a_repeated_command_session_yields_exactly_one_ledger_row`, `the_breaker_trips_after_configured_failures_and_blocks_the_next_launch`, `rollback_round_trips_a_prior_version_and_the_gate_accepts_it`, `a_redirect_heavy_template_survives_rendering_byte_exact`, `an_available_wrapper_really_denies_the_network`.

## RF-P2 — Skill mining, promotion with lift, and demotion

Requires A5–A7 landed — merged in macanderson/stella#5468. Config keys involved: `context.promotion.skill.require_measured_lift` (default `true`) and `context.promotion.skill.demote_after_consecutive_negatives` (default `3`). Ledgers: `.stella/private/skill_trials.jsonl` (turn-level trials), `.stella/private/skill_appraisals.jsonl` (measured verdicts); a demotion is a `Retired` promotion event appended to the append-only `context_records` ledger — the skill file stays on disk.

Proof procedure:
1. During epics E2–E3, Stella's reflections (`.stella/private/reflections.jsonl`) accumulate; the inline end-of-turn miner (already live) mines ≥1 skill from Rainforest-build reflections (expected shape: "run `pnpm reconcile` before committing seed-generator changes").
2. The mined skill is **selected** by `select_skills` in a later session and observably applied (transcript shows the behavior).
3. Promotion record carries `MeasuredLift` evidence (A6) — before/after outcome delta on reconcile-adjacent tasks. Throughput caveat (macanderson/stella#5487): the without-skill control arm is sampled at `context.retrieval.ab_recall_rate` (default 1 turn in 10), so a verdict needs on the order of tens of trigger-matched turns; the proof budgets for that rather than lowering recall for the whole build.
4. Demotion: the **orchestrating agent** plants one deliberately harmful skill under `.stella/skills/` (e.g., "always regenerate all seed data on any schema change" — measurably wasteful); outcomes accrue ≥3 negative appraisals through the live trial→sweep seams; assert `skill_appraisals.jsonl` rows exist, a `Retired` event was appended, and the skill is no longer selected. No person authors, plants, or removes the skill.

Observable evidence:
- [ ] reflections rows → mined skill file under `.stella/skills/` (append-only ledger row; DB triggers verified blocking UPDATE/DELETE)
- [ ] `select_skills` trace showing selection in a later session
- [ ] promotion record with `MeasuredLift` evidence
- [ ] `skill_appraisals.jsonl` with ≥3 negative rows for the planted skill + the `Retired` promotion event + a subsequent non-selection trace
- [ ] all committed to `proofs/skill-mining.md`

Automated witness tests (`crates/stella-cli/src/memory/learning/skill_lifecycle.rs`): `a_mined_skill_lands_reloads_and_is_selected_for_a_matching_task`, `the_measured_gate_holds_a_candidate_until_a_recorded_lift_promotes_it`, `a_promoted_skill_that_stops_helping_is_demoted_and_no_longer_selected`.

## RF-P3 — Skill functions (invoke directives)

Requires A8 landed — merged in macanderson/stella#5467 (`stella skill run` + in-session `/slug` expansion; `invoke_skill` stays retired).

Proof procedure:
1. Stella (or the orchestrating agent) authors a skill `generate-quarter-seed` in the rainforest repo's `.stella/skills/` carrying invoke directives: `context: fork`, `allowed-tools: bash, read, write` (no network/gh), pinned `model`/`effort`.
2. Invoke it both ways, both driven by the orchestrating agent: (a) `stella skill run generate-quarter-seed -- --quarter 2025-Q3`; (b) in-session directive expansion by issuing `/generate-quarter-seed --quarter 2025-Q3` in a session during E3 work. Note: a directive-carrying skill that recall auto-selects does **not** expand in the shipped build (macanderson/stella#5465 tracks that decision), so (b) is the explicit `/slug` path — still no person involved.
3. Demonstrate grant narrowing: inside the scoped run, an attempted disallowed tool call is denied by the `skill_grant` / `skill_plane` intersection — captured in transcript.

Observable evidence:
- [ ] skill file with directives, parsed (no parser errors) — the `parse_invoke_directives` path
- [ ] scoped-run transcript showing the narrowed tool set + one denial
- [ ] seed artifacts produced by the run, reconciliation green
- [ ] `active_skill_slugs()` returning the real slug set (log line), stub gone
- [ ] committed to `proofs/skill-functions.md`

Automated witness tests: `the_directive_parse_table_covers_every_key_and_separator`, `a_live_skill_grant_denies_a_disallowed_tool_and_lifts_when_the_span_ends`, `a_skill_grant_over_the_session_stack_denies_disallowed_and_never_widens`, `a_directive_carrying_skill_expands_as_an_invocation_with_its_scope`, `plan_resolves_the_slug_and_carries_the_directive_scope`, `a_grant_scoped_child_cannot_see_or_call_outside_its_grant`.

## RF-P4 — Autonomous delivery (the meta-proof)

Requires A9 (macanderson/stella#5457, still open) — or the documented degraded mode. In **both** modes there is no human merge authority and no human review gate: every PR is opened with auto-merge enabled and merges the moment CI is green (AGENTS.md §3).

- **Full mode (the intended path):** Stella's delivery verb works the Rainforest backlog: for each `status:ready` issue — branch, implement, PR referencing the issue, CI green, auto-merge. Target: ≥80% of the 45 issues closed via Stella PRs; autonomy ledger rows per cycle.
- **Degraded mode (fallback while A9 is unmerged — not the intended path):** the orchestrating agent launches one Stella session per issue with the issue body as the prompt; everything else identical, including auto-merge on CI green. State which mode was used in `proofs/delivery.md` — do not blur them.

## 3.4 Phase gate

| Phase | Content | Gate |
|---|---|---|
| P0 | Stella work: A1–A8 (A9 best-effort) + witness tests | **Closed 2026-08-30** — A1–A8 merged to Stella main `5f1de6a6a` (macanderson/stella#5476, #5468, #5467); gate issue #1 closed. A9 remains open, so RF-P4 starts in degraded mode. E3+ may begin. |
| P1 | Rainforest build E1→E8 by Stella | Each epic's closing checklist includes any proof events assigned to it |
| P2 | Proof audit | All RF-P1..P4 checklists fully checked; `proofs/` committed; evolution ratchet 0 |
