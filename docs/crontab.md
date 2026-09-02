# Host crontab — agent ticks and living-demo jobs

The entries the host installs for this app (docs/architecture.md §7.2 "Topology",
§9.2 "Loop shape — cron-triggered endpoints"). There is no resident daemon: the
system crontab hits the app's authenticated HTTP endpoints with the bearer secret
from the environment file. This file is the reference copied into place by the
deploy/install step (E7#4).

Schedules: the three operational agents (§9.1) tick every 15 minutes; the
living-demo jobs run daily at 04:00 UTC (clock-shift) and 08:00 UTC (demo-wipe).
Sourcing `.env` makes the secret expand inside the single-quoted command strings
below — cron runs each entry through `/bin/sh`.

```crontab
# ▸ Operational agents (§9.1) — every 15 minutes
*/15 * * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $AGENT_SECRET" http://localhost:3000/api/agents/run/auto-reorder
*/15 * * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $AGENT_SECRET" http://localhost:3000/api/agents/run/fulfillment
*/15 * * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $AGENT_SECRET" http://localhost:3000/api/agents/run/exception

# ▸ Living-demo jobs (§8)
0 4 * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/clock-shift
0 8 * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/demo-wipe
```

Notes:

- The bearer secret must be read from the environment file each tick — never
  pasted into the crontab itself (a `crontab -l` by any host user must not
  leak it).
- `AGENT_SECRET` and `CRON_SECRET` may be the same value; the endpoints accept
  either var (agent endpoints prefer `AGENT_SECRET`, job endpoints prefer
  `CRON_SECRET`, each falls back to the other).
- Dry-run is invokable per tick by passing `--data '{"dryRun": true}'` (or
  `?dry-run`); the run ledger records it as outcome `dry_run`.
