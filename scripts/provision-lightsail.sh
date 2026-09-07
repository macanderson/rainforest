#!/usr/bin/env bash
# provision-lightsail.sh — provision the Rainforest demo's single Lightsail box.
#
# Automates every scriptable step of docs/deploy/lightsail-runbook.md:
# package install (Caddy), /var/lib/rainforest/ layout, Caddy TLS config,
# systemd service for the Next.js standalone build, and the system crontab.
# The AWS account-side provisioning (instance, static IP, firewall 80/443/22,
# sslip.io hostname) is already done — see the runbook's "Provisioned facts".
#
# Usage (on the instance, as root):
#   DOMAIN=rainforest.<static-ip>.sslip.io ./scripts/provision-lightsail.sh
#
# Idempotent: safe to re-run.
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN to the sslip.io hostname, e.g. DOMAIN=rainforest.1.2.3.4.sslip.io}"
APP_USER=rainforest
DATA_DIR=/var/lib/rainforest
CONF_DIR=/etc/rainforest
ENV_FILE="$CONF_DIR/.env"
APP_DIR=/opt/rainforest

if [[ $EUID -ne 0 ]]; then
  echo "error: run as root (sudo)" >&2
  exit 1
fi

echo "==> [1/6] Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl sqlite3 ca-certificates debian-keyring debian-archive-keyring apt-transport-https
if ! command -v caddy >/dev/null 2>&1; then
  install -dm755 /etc/apt/keyrings
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> [2/6] User and directory layout"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR"   # SQLite home (architecture.md §7.2)
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_DIR"    # standalone build lands here (deploy pipeline)
install -d -m 0750 "$CONF_DIR"

echo "==> [3/6] Secrets ($ENV_FILE)"
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  {
    echo "SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "AGENT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "CRON_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  } > "$ENV_FILE"
  echo "    generated new secrets"
else
  echo "    keeping existing secrets"
fi
chmod 0600 "$ENV_FILE"

echo "==> [4/6] Caddy TLS config ($DOMAIN → 127.0.0.1:3000)"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	reverse_proxy 127.0.0.1:3000
}
EOF
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "==> [5/6] rainforest.service (Next.js standalone on :3000)"
cat > /etc/systemd/system/rainforest.service <<EOF
[Unit]
Description=Rainforest demo (Next.js standalone)
After=network-online.target caddy.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=HOSTNAME=127.0.0.1
Environment=PORT=3000
Environment=DATABASE_PATH=$DATA_DIR/rainforest.db
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable rainforest.service
# Started by the deploy pipeline once the standalone build is in $APP_DIR;
# starting now would fail on a fresh box with no artifact yet.

echo "==> [6/6] System crontab (agent ticks + living-demo jobs)"
crontab - <<'EOF'
# ▸ Operational agents (architecture.md §9.1) — every 15 minutes
*/15 * * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $AGENT_SECRET" http://localhost:3000/api/agents/run/auto-reorder
*/15 * * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $AGENT_SECRET" http://localhost:3000/api/agents/run/fulfillment
*/15 * * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $AGENT_SECRET" http://localhost:3000/api/agents/run/exception

# ▸ Living-demo jobs (architecture.md §8)
0 4 * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/clock-shift
0 8 * * * . /etc/rainforest/.env && curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/demo-wipe
EOF

echo
echo "Done. Verify with: curl -fsS https://$DOMAIN/api/health"
