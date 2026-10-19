#!/usr/bin/env bash
# Installe (ou met à jour) Elegance Barber Shop sur un VPS Ubuntu / Debian :
#   Node.js 20, service systemd (redémarre tout seul), HTTPS automatique avec Caddy.
# Lancé par deploy.ps1 depuis le PC. À la main (en root, depuis le dossier de l'application) :
#   bash deploy/setup.sh [domaine]
# Sans domaine, l'adresse sera <ip-du-vps>.sslip.io (HTTPS valide, gratuit).
set -euo pipefail

APP=/opt/elegance-barbershop
DATA=/var/lib/elegance-barbershop
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script en root (sudo)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

if [ -z "$DOMAIN" ]; then
  if [ -f /etc/caddy/Caddyfile ] && grep -q '^# elegance-barbershop' /etc/caddy/Caddyfile; then
    DOMAIN="$(sed -n 's/^\([^ #][^ ]*\) {$/\1/p' /etc/caddy/Caddyfile | head -1)" # garde l'adresse de la première installation
  fi
  if [ -z "$DOMAIN" ]; then
    IP="$(curl -4 -fsS https://api.ipify.org)"
    DOMAIN="${IP//./-}.sslip.io"
  fi
fi

echo "==> Paquets système"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https build-essential python3 >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v caddy >/dev/null; then
  echo "==> Caddy (HTTPS automatique)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

echo "==> Application"
id -u barber >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin barber
mkdir -p "$APP" "$DATA"
# données envoyées depuis le PC (deploy.ps1 -WithData) : seulement si le serveur n'a pas encore de base
# (anciens fichiers ; la base, photos comprises, est sur PostgreSQL) : les fichiers déjà sur le serveur sont gardés
if [ -d "$SRC/data" ]; then
  cp -rn "$SRC/data/." "$DATA/"; rm -f "$DATA"/barber.db*; echo "    fichiers du PC copiés (photos, clés)"
fi
# la chaîne de connexion PostgreSQL (fichier .env, envoyé par deploy.ps1)
[ -f "$SRC/.env" ] || [ -f "$APP/.env" ] || { echo "❌ Fichier .env absent : copiez .env.example en .env et mettez-y DATABASE_URL."; exit 1; }
if [ "$SRC" != "$APP" ]; then
  find "$APP" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .env -exec rm -rf {} +
  tar -C "$SRC" --exclude=./data --exclude=./node_modules -cf - . | tar -C "$APP" -xf -
fi
cd "$APP"
npm ci --omit=dev --no-audit --no-fund
chown -R barber:barber "$APP" "$DATA"
chmod 600 "$APP/.env"

cat > /etc/systemd/system/elegance-barbershop.service <<EOF
[Unit]
Description=Elegance Barber Shop
After=network.target

[Service]
User=barber
WorkingDirectory=$APP
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=3000 DATA_DIR=$DATA TZ=Africa/Tunis VAPID_SUBJECT=mailto:contact@$DOMAIN
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
# elegance-barbershop
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF

if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

systemctl daemon-reload
systemctl enable elegance-barbershop >/dev/null 2>&1
systemctl restart elegance-barbershop
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

sleep 3
systemctl is-active --quiet elegance-barbershop || { journalctl -u elegance-barbershop -n 30 --no-pager; exit 1; }
echo
echo "✅ Elegance Barber Shop est en ligne : https://$DOMAIN"
echo "   (le certificat HTTPS peut prendre une minute la première fois)"
echo "   Journal : journalctl -u elegance-barbershop -f"
