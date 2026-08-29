# Rainforest

**A proving ground.** This repository specifies — entirely through markdown documents and a GitHub issue system — an enterprise warehouse / inventory / supply-chain demo application for **Rainforest, Inc.**, a fictional regional-scale e-commerce company. The issues in this repo are executed **autonomously by [Stella](https://github.com/macanderson/stella)**, an AI coding agent: the build itself is the integration test for Stella's self-improvement machinery (tool foundry, skill mining, skill functions, and autonomous delivery). Evidence of each capability proof is committed under `proofs/` as the build progresses.

## What lives here

- **`RAINFOREST.md`** — the business fiction: company history, the failed "One Basket" strategy, the leadership transition, and the "Fulfillment Flywheel" pivot.
- **`docs/`** — the numbers bible (canonical quarterly financials), architecture decisions, and data specs every generator and report must derive from.
- **`data/numbers-bible.json`** — the machine-readable single source of truth for every figure; a CI reconciliation check makes drift mechanically impossible.
- **`proofs/`** — observable evidence that Stella's capabilities fired during the build.
- **GitHub issues** — 8 epics and their sub-issues: the complete, dependency-ordered spec of the app. Stella picks ready issues, works them on branches, and opens PRs.

This repo intentionally contains **no application code** at inception — only specifications. The application is built issue-by-issue by the agent.

## Fiction disclaimer

**All entities in this repository are fictional and all data is synthetic.** Rainforest, Inc., its founders, executives, suppliers, financials, and every other named company or person are inventions for demonstration purposes. Any resemblance to real companies or people is coincidental. No real company or person is referenced as an actor or competitor.

## License

[MIT](LICENSE)
