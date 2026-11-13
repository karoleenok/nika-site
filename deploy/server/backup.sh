#!/usr/bin/env bash
# Ночной бэкап базы: дамп → шифрование (AES-256, пароль BACKUP_PASSPHRASE) → отдельное S3-хранилище.
# В базе персональные данные и ответы о здоровье, поэтому без шифрования файл из сервера не уходит.
# При сбое письмо на ALERT_EMAIL. Запускает nika-backup.timer.
set -Eeuo pipefail
ROOT="${NIKA_ROOT:-/srv/nika}"
ENV_FILE="${ENV_FILE:-$ROOT/shared/.env}"
DIR="$ROOT/backups"
IMG="${APP_IMAGE:-nika-app:current}"
DB_CONTAINER="${DB_CONTAINER:-nika-db-1}"
getenv() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }
s3() { docker run --rm --network host --user "$(id -u):$(id -g)" --env-file "$ENV_FILE" -v "$DIR:/backups" "$IMG" node scripts/backup-s3.js "$@"; }
fail() { echo "бэкап НЕ сделан: $1" >&2; s3 alert "бэкап базы не сделан ($1)" || true; exit 1; }
trap 'fail "ошибка в строке $LINENO"' ERR

PASS="$(getenv BACKUP_PASSPHRASE)"
[ ${#PASS} -ge 32 ] || fail "BACKUP_PASSPHRASE короче 32 символов"
umask 077
F="$DIR/nika-$(date -u +%Y-%m-%dT%H%M%SZ).dump.gpg"
docker exec "$DB_CONTAINER" pg_dump -U nika -d nika --format=custom --no-owner \
  | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --pinentry-mode loopback --passphrase-fd 3 -o "$F" 3<<<"$PASS"
s3 put "/backups/$(basename "$F")"
s3 prune 30
# На самом сервере держим 3 последних файла: быстрый откат без скачивания
ls -1t "$DIR"/nika-*.dump.gpg | tail -n +4 | xargs -r rm -f
echo "бэкап готов: $(basename "$F")"
