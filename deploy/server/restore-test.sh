#!/usr/bin/env bash
# Пробное восстановление: скачивает последний бэкап из S3, расшифровывает и разворачивает
# во временную базу в отдельном контейнере без сети. Проверяет, что таблицы и данные на месте.
# Рабочую базу не трогает. При сбое письмо на ALERT_EMAIL. Запускает nika-restore-test.timer.
set -Eeuo pipefail
ROOT="${NIKA_ROOT:-/srv/nika}"
ENV_FILE="${ENV_FILE:-$ROOT/shared/.env}"
IMG="${APP_IMAGE:-nika-app:current}"
WORK="$(mktemp -d "$ROOT/backups/restore.XXXXXX")"
NAME="nika-restore-test-$$"
getenv() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }
s3() { docker run --rm --network host --user "$(id -u):$(id -g)" --env-file "$ENV_FILE" -v "$WORK:/work" "$IMG" node scripts/backup-s3.js "$@"; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
fail() { echo "пробное восстановление НЕ прошло: $1" >&2; s3 alert "пробное восстановление бэкапа не прошло ($1)" || true; cleanup; exit 1; }
trap 'fail "ошибка в строке $LINENO"' ERR
trap cleanup EXIT
umask 077

s3 latest /work/latest.dump.gpg
gpg --batch --quiet --decrypt --pinentry-mode loopback --passphrase-fd 3 -o "$WORK/latest.dump" "$WORK/latest.dump.gpg" 3<<<"$(getenv BACKUP_PASSPHRASE)"
chmod 644 "$WORK/latest.dump"

docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=restore \
  -v "$WORK/latest.dump:/latest.dump:ro" postgres:16.16-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -d restore -q && break; sleep 2; done
# initdb перезапускает сервер один раз: ждём, пока он ответит на запрос
for _ in $(seq 1 30); do docker exec "$NAME" psql -U postgres -d restore -qtAc 'select 1' >/dev/null 2>&1 && break; sleep 2; done
docker exec "$NAME" pg_restore -U postgres -d restore --no-owner --exit-on-error /latest.dump

q() { docker exec "$NAME" psql -U postgres -d restore -qtAc "$1"; }
MIG="$(q 'select count(*) from schema_migrations')"
FILES="$(ls -1 "$ROOT/current/server/migrations"/*.sql 2>/dev/null | wc -l)"
USERS="$(q 'select count(*) from users')"
ADMINS="$(q 'select count(*) from admins')"
[ "$MIG" -ge 1 ] || fail "в бэкапе нет миграций"
[ "$FILES" -eq 0 ] || [ "$MIG" -eq "$FILES" ] || fail "миграций в бэкапе $MIG, в коде $FILES"
[ "$ADMINS" -ge 1 ] || fail "в бэкапе нет ни одного админа"
echo "восстановление прошло: миграций $MIG, клиентов $USERS, админов $ADMINS"
