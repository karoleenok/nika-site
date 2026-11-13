#!/usr/bin/env bash
# Получает сертификат Let's Encrypt и включает боевой конфиг nginx.
# Запускается таймером nika-cert.timer, пока сертификата нет; потом таймер выключается сам.
# Продление делает certbot.timer из пакета certbot.
set -euo pipefail
. /etc/nika/domain
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if [ ! -f "$CERT" ]; then
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos -m "$LE_EMAIL" --no-eff-email --keep-until-expiring \
    || { echo "сертификат пока не получен: домен ещё не смотрит на сервер?"; exit 1; }
fi
sed "s/__DOMAIN__/$DOMAIN/g" /etc/nika/nika.conf > /etc/nginx/sites-available/nika
nginx -t && systemctl reload nginx
systemctl disable --now nika-cert.timer 2>/dev/null || true
echo "HTTPS включён для $DOMAIN"
