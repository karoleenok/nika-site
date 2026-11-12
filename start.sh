#!/bin/sh
# Запуск сайта на своём компьютере. Нужен только Docker Desktop.
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  rnd() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
  DBP=$(rnd 24)
  cat > .env <<ENV
PUBLIC_URL=http://localhost:3000
SESSION_SECRET=$(rnd 64)
NODE_ENV=development
PORT=3000
DB_PASSWORD=$DBP
DATABASE_URL=postgres://nika:$DBP@127.0.0.1:5432/nika
S3_ENDPOINT=http://127.0.0.1:8333
S3_PUBLIC_ENDPOINT=http://localhost:8333
S3_REGION=us-east-1
S3_BUCKET=nika-videos
S3_ACCESS_KEY=local$(rnd 12)
S3_SECRET_KEY=$(rnd 32)
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=0
MAIL_FROM=noreply@mail.example.ru
MAIL_REPLY_TO=nika@example.com
ADMIN_NOTIFY_EMAIL=nika@example.com
ROBOKASSA_LOGIN=
ROBOKASSA_PASSWORD1=
ROBOKASSA_PASSWORD2=
ROBOKASSA_TEST=1
ENV
  echo "Создан .env с локальными настройками"
fi

docker compose up -d
printf "Жду, пока сайт запустится"
i=0
until curl -fs http://localhost:3000/api/health >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 90 ] && { echo; echo "Не запустилось. Подробности: docker compose logs app"; exit 1; }
  printf "."; sleep 2
done
echo
echo "Готово."
echo "  Сайт:           http://localhost:3000"
echo "  Письма (коды):  http://localhost:8025"
echo "Остановить: docker compose down"
