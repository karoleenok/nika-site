#!/usr/bin/env bash
# Обновляет боевой конфиг nginx из выложенной версии. Запускает deploy через sudo (только этот скрипт).
# Берёт шаблон строго из /srv/nika/current, проверяет nginx -t, при ошибке возвращает прежний конфиг.
set -euo pipefail
. /etc/nika/domain
SRC="$(readlink -f /srv/nika/current)/deploy/nginx/nika.conf"
case "$SRC" in /srv/nika/releases/*) ;; *) echo "шаблон не из /srv/nika/releases"; exit 1;; esac
[ -f "$SRC" ] || { echo "нет $SRC"; exit 1; }
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  nginx -t && systemctl reload nginx; exit 0     # до сертификата работает временный http-конфиг
fi
SITE=/etc/nginx/sites-available/nika
cp -f "$SITE" "$SITE.bak" 2>/dev/null || true
install -m 644 "$SRC" /etc/nika/nika.conf.new
sed "s/__DOMAIN__/$DOMAIN/g" /etc/nika/nika.conf.new > "$SITE"
if nginx -t; then
  mv -f /etc/nika/nika.conf.new /etc/nika/nika.conf
  systemctl reload nginx
  systemctl disable --now nika-cert.timer 2>/dev/null || true
else
  [ -f "$SITE.bak" ] && mv -f "$SITE.bak" "$SITE"
  rm -f /etc/nika/nika.conf.new
  echo "новый конфиг nginx не прошёл проверку, оставлен прежний"; exit 1
fi
