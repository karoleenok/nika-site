#!/usr/bin/env bash
# Выкладка одной версии. Вызывает GitHub Actions по SSH от пользователя deploy:
#   remote-deploy.sh <sha>
# Перед вызовом Actions уже скопировал код в /srv/nika/releases/<sha> и записал /srv/nika/shared/.env.
# Порядок: образ → база → миграции → заголовки → переключение → проверка здоровья → при сбое откат.
set -euo pipefail
SHA="${1:?нужен sha}"
ROOT="${NIKA_ROOT:-/srv/nika}"
REL="$ROOT/releases/$SHA"
ENV_FILE="$ROOT/shared/.env"
export APP_TAG="$SHA" ENV_FILE
cd "$REL"
compose() { docker compose -p nika -f "$REL/deploy/compose.prod.yml" --env-file "$ENV_FILE" "$@"; }
log() { echo "[deploy $SHA] $*"; }

log "статика: в public/ только файлы сайта, без сервера и служебного"
rsync -a --delete \
  --exclude='/public' --exclude='/server' --exclude='/deploy' --exclude='/tools' --exclude='/.github' \
  --exclude='/.git*' --exclude='/.env*' --exclude='/.htaccess' --exclude='/.dockerignore' \
  --exclude='/start.sh' --exclude='/docker-compose.yml' --exclude='*.md' \
  ./ public/

log "образ приложения"
docker build -q -f deploy/Dockerfile -t "nika-app:$SHA" . >/dev/null

log "база"
compose up -d --wait db

log "миграции (до переключения: новые поля добавляются, старые не удаляются)"
compose run --rm --no-deps app node scripts/setup.js

log "заголовки безопасности и CSP для nginx"
CSP=$(docker run --rm --env-file "$ENV_FILE" "nika-app:$SHA" node -e \
  "import('./src/csp.js').then(m => process.stdout.write(m.cspHeader(process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT)))")
case "$CSP" in *'"'*|'') echo "CSP пустая или с кавычками"; exit 1;; esac
cat > "$ROOT/shared/nginx-headers.conf.new" <<HDR
add_header Content-Security-Policy "$CSP; upgrade-insecure-requests" always;
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(self)" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
HDR
mv -f "$ROOT/shared/nginx-headers.conf.new" "$ROOT/shared/nginx-headers.conf"

PREV="$(readlink "$ROOT/current" 2>/dev/null || true)"
switch_to() {   # $1 = папка версии
  ln -sfn "$1" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"
  APP_TAG="$(basename "$1")" compose up -d --no-deps app
  [ "${NIKA_SKIP_NGINX:-0}" = 1 ] || { sudo /usr/sbin/nginx -t && sudo /usr/bin/systemctl reload nginx; }
}
healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

log "переключение"
switch_to "$REL"
if ! healthy; then
  log "НЕ ОТВЕЧАЕТ. Последние строки лога:"
  compose logs --tail=40 app || true
  if [ -n "$PREV" ] && [ "$PREV" != "$REL" ]; then
    log "откат на $(basename "$PREV")"
    switch_to "$PREV"
    if healthy; then log "старая версия работает"; else log "и старая версия не отвечает"; fi
  fi
  exit 1
fi
docker tag "nika-app:$SHA" nika-app:current

log "уборка: оставляем 5 последних версий"
mapfile -t OLD < <(ls -1dt "$ROOT"/releases/*/ | tail -n +6)
for d in "${OLD[@]}"; do
  t="$(basename "$d")"
  [ "$ROOT/releases/$t" = "$(readlink "$ROOT/current")" ] && continue
  rm -rf "$d"; docker rmi "nika-app:$t" >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null
log "готово"
