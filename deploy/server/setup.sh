#!/usr/bin/env bash
# Первичная настройка чистого VPS (Ubuntu 24.04). Запускается один раз через cloud-init
# (deploy/cloud-init.yaml), руками на сервер заходить не нужно. Повторный запуск безопасен.
# Нужны переменные: DOMAIN, LE_EMAIL, DEPLOY_PUBKEY.
set -euo pipefail
: "${DOMAIN:?нужен DOMAIN}" "${LE_EMAIL:?нужен LE_EMAIL}" "${DEPLOY_PUBKEY:?нужен DEPLOY_PUBKEY}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"     # папка deploy/ из репозитория
export DEBIAN_FRONTEND=noninteractive
log() { echo "[nika-setup] $*"; }

log "обновление системы и пакеты"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get install -y -q ca-certificates curl gnupg ufw fail2ban unattended-upgrades nginx certbot rsync

log "Docker из официального репозитория"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" }, "live-restore": true }
JSON
systemctl restart docker

log "часовой пояс Хабаровска: бэкап и перезагрузки ночью по времени Ники"
timedatectl set-timezone Asia/Vladivostok

log "подкачка 2 ГБ (сервер на 2 ГБ памяти, сборка образа иначе может упасть)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null && echo 'vm.swappiness=10' > /etc/sysctl.d/90-nika.conf

log "пользователь deploy: только вход по ключу GitHub Actions"
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf '%s\n' "$DEPLOY_PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
# Единственное, что deploy может делать от root: проверить и перечитать конфиг nginx
cat > /etc/sudoers.d/nika-deploy <<'SUDO'
deploy ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx
SUDO
chmod 440 /etc/sudoers.d/nika-deploy
visudo -cf /etc/sudoers.d/nika-deploy

log "SSH: root закрыт, пароли выключены"
cat > /etc/ssh/sshd_config.d/00-nika.conf <<'SSH'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
SSH
sshd -t
systemctl restart ssh

log "файрвол: открыты только 22, 80, 443"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
# Порты Docker идут мимо ufw. Поэтому база и приложение слушают только 127.0.0.1 (compose.prod.yml).

log "fail2ban для SSH"
cat > /etc/fail2ban/jail.d/nika.conf <<'F2B'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
F2B
systemctl enable --now fail2ban
systemctl restart fail2ban

log "автообновления безопасности, перезагрузка при необходимости в 04:30"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT
cat > /etc/apt/apt.conf.d/52nika-unattended <<'APT'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
APT
systemctl enable --now unattended-upgrades

log "папки сайта"
install -d -o deploy -g deploy -m 750 /srv/nika /srv/nika/releases /srv/nika/shared
install -d -o deploy -g deploy -m 700 /srv/nika/backups
install -d -m 755 /var/www/certbot /etc/nika
# Заголовки по умолчанию до первой выкладки (выкладка перезапишет)
if [ ! -f /srv/nika/shared/nginx-headers.conf ]; then
  cat > /srv/nika/shared/nginx-headers.conf <<'HDR'
add_header Content-Security-Policy "default-src 'self'; object-src 'none'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
HDR
  chown deploy:deploy /srv/nika/shared/nginx-headers.conf
fi
chmod 755 /srv/nika   # nginx (www-data) читает статику
cp "$SRC/nginx/nika.conf" "$SRC/nginx/nika-http.conf" /etc/nika/
echo "DOMAIN=$DOMAIN" > /etc/nika/domain
echo "LE_EMAIL=$LE_EMAIL" >> /etc/nika/domain

log "nginx: временный конфиг до сертификата"
rm -f /etc/nginx/sites-enabled/default
sed "s/__DOMAIN__/$DOMAIN/g" /etc/nika/nika-http.conf > /etc/nginx/sites-available/nika
ln -sfn /etc/nginx/sites-available/nika /etc/nginx/sites-enabled/nika
sed -i 's/^\s*#\?\s*server_tokens .*/\tserver_tokens off;/' /etc/nginx/nginx.conf
nginx -t && systemctl reload nginx

log "сертификат: пробуем каждые 10 минут, пока домен не начнёт смотреть на сервер"
install -m 755 "$SRC/server/get-cert.sh" /usr/local/sbin/nika-get-cert
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
cp "$SRC"/server/systemd/*.service "$SRC"/server/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nika-cert.timer
systemctl enable certbot.timer 2>/dev/null || true    # продление сертификата (ставит пакет certbot)
systemctl enable nika-backup.timer nika-restore-test.timer
systemctl start nika-backup.timer nika-restore-test.timer
/usr/local/sbin/nika-get-cert || true

log "готово. Дальше всё делает GitHub Actions."
