# Lightsail provisioning runbook

The demo's ~$12/mo home: one AWS Lightsail instance running the Next.js standalone build, the
SQLite file, system cron, and Caddy TLS. This is the operational companion to
[architecture.md §7](../architecture.md#7-deploy-target--one-lightsail-box).

## 1. Provisioned facts (AWS account side — already done)

The account-side provisioning was completed on 2026-08-30. These are **facts to record, not steps
to perform** — nothing in this runbook waits on a human:

| Fact | Value |
| --- | --- |
| Instance | AWS Lightsail, 2 GB RAM / 1 vCPU / 60 GB SSD (~$12/mo bundle), Ubuntu 24.04 LTS |
| Static IP | Attached to the instance (recorded in the AWS console; the hostname below resolves to it) |
| Firewall | Inbound TCP **80** (HTTP → ACME + redirect), **443** (HTTPS), **22** (SSH) open; all else closed |
| Hostname | `rainforest.<static-ip>.sslip.io` — sslip.io wildcard DNS maps the static IP to a resolvable name so Caddy can obtain a real Let's Encrypt certificate with no DNS provider setup |

sslip.io is used because the demo has no registered domain; the hostname is derived mechanically
from the static IP, so if the IP ever changes the hostname is recomputed the same way and the
Caddyfile is updated to match (one line, then `systemctl reload caddy`).

## 2. What the box runs (architecture.md §7.2)

```
[ Lightsail 2 GB, static IP, firewall 80/443/22 ]
  Caddy (TLS, reverse proxy :443 → :3000)
  Next.js 16 standalone (node, port 3000)
  /var/lib/rainforest/rainforest.db   (SQLite, local disk)
  system crontab:
    agent ticks   → POST /api/agents/run/<agent>   (bearer secret)
    04:00 UTC     → clock-shift job (+1 day on seed rows)
    08:00 UTC     → demo-wipe job (delete demo rows, restore mutated seed)
```

## 3. Provisioning — one script, no human steps

Everything scriptable is automated by [`scripts/provision-lightsail.sh`](../../scripts/provision-lightsail.sh).
Run it **on the instance** as root (or via `sudo`) right after first SSH:

```bash
ssh ubuntu@rainforest.<static-ip>.sslip.io
curl -fsSL https://raw.githubusercontent.com/macanderson/rainforest/main/scripts/provision-lightsail.sh \
  | sudo DOMAIN=rainforest.<static-ip>.sslip.io bash
```

Or from a checkout: `sudo DOMAIN=rainforest.<static-ip>.sslip.io scripts/provision-lightsail.sh`.

The script is idempotent (safe to re-run) and performs, in order:

1. **Package install** — `apt-get update`, then `caddy` (from the official Caddy apt repo, so TLS
   automation and `systemd` integration come with it), plus `curl`, `sqlite3`, and `ca-certificates`.
2. **Directory layout** — creates `/var/lib/rainforest/` (the SQLite home, per §7.2) and
   `/etc/rainforest/`, owned by a dedicated `rainforest` system user; the app runs as this user,
   never root.
3. **Caddy config** — writes `/etc/caddy/Caddyfile`:

   ```caddyfile
   rainforest.<static-ip>.sslip.io {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   Caddy obtains and renews the Let's Encrypt certificate automatically (this is why port 80 is
   open — the ACME HTTP-01 challenge) and redirects HTTP → HTTPS. `caddy validate` runs before the
   reload, so a bad config can never take the site down.
4. **Service setup** — installs and enables a `rainforest.service` systemd unit that runs the
   Next.js standalone server (`node server.js`) on `127.0.0.1:3000` with
   `DATABASE_PATH=/var/lib/rainforest/rainforest.db`, `NODE_ENV=production`, and the secrets
   (`SESSION_SECRET`, `AGENT_SECRET`/`CRON_SECRET`) read from `/etc/rainforest/.env` (mode 0600,
   generated on first run with random values if absent). The unit restarts on failure and starts
   after network + Caddy.
5. **Cron** — installs the system crontab entries from [docs/crontab.md](../crontab.md): agent
   ticks plus the 04:00 UTC clock-shift and 08:00 UTC demo-wipe jobs, each calling
   `https://$DOMAIN/api/...` with `Authorization: Bearer $CRON_SECRET`.

The app artifact itself (the standalone build) is delivered by the deploy pipeline (E7#3/E7#5);
the provisioning script creates the service and environment it lands in.

## 4. Verification

After the script finishes, from any machine:

```bash
curl -fsS https://rainforest.<static-ip>.sslip.io/api/health
```

A `200` JSON body with database reachability confirms the full chain: DNS → static IP → Caddy TLS
→ reverse proxy → Next.js → SQLite at `/var/lib/rainforest/rainforest.db`. The certificate is
verified by the TLS handshake itself — a fresh instance provisioned by this runbook serves valid
TLS at the chosen domain with no manual certificate step.

Also on the box:

```bash
systemctl status caddy rainforest   # both active (enabled)
caddy validate --config /etc/caddy/Caddyfile
crontab -l                          # agent ticks + 04:00/08:00 UTC jobs
```
