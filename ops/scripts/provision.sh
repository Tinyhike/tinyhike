#!/usr/bin/env bash
# Provision a fresh Ubuntu 24.04 Hetzner VPS for TinyHike.
# Run as root: bash provision.sh
set -euo pipefail

DEPLOY_USER="tinyhike"

echo "==> System update"
apt-get update -qq && apt-get upgrade -y -qq

echo "==> Essentials"
apt-get install -y -qq curl git ufw fail2ban unattended-upgrades

echo "==> Swap 2 GB"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Docker"
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

echo "==> Deploy user: ${DEPLOY_USER}"
id "${DEPLOY_USER}" &>/dev/null || useradd -m -s /bin/bash "${DEPLOY_USER}"
usermod -aG docker "${DEPLOY_USER}"
mkdir -p /home/${DEPLOY_USER}/.ssh
[ -f /root/.ssh/authorized_keys ] && cp /root/.ssh/authorized_keys /home/${DEPLOY_USER}/.ssh/
chown -R ${DEPLOY_USER}:${DEPLOY_USER} /home/${DEPLOY_USER}/.ssh
chmod 700 /home/${DEPLOY_USER}/.ssh
chmod 600 /home/${DEPLOY_USER}/.ssh/authorized_keys 2>/dev/null || true

echo "==> UFW"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> fail2ban"
systemctl enable --now fail2ban

echo "==> App directory"
mkdir -p /srv/tinyhike
chown ${DEPLOY_USER}:${DEPLOY_USER} /srv/tinyhike

echo "==> Docker network"
docker network create tinyhike_net 2>/dev/null || true

echo "==> Done. SSH in as ${DEPLOY_USER} and run: git clone … /srv/tinyhike"
