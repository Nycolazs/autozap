#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "[oracle-setup] Execute este script como root (sudo)." >&2
  exit 1
fi

APP_USER="${APP_USER:-autozap}"
APP_DIR="${APP_DIR:-/opt/autozap}"

if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
else
  echo "[oracle-setup] Nenhum gerenciador de pacotes suportado encontrado (apt/dnf)." >&2
  exit 1
fi

install_base_packages() {
  if [[ "${PKG_MGR}" == "apt" ]]; then
    echo "[oracle-setup] Instalando pacotes do sistema (apt)..."
    apt-get update
    apt-get install -y ca-certificates curl gnupg git build-essential ufw nginx certbot python3-certbot-nginx
    return
  fi

  echo "[oracle-setup] Instalando pacotes do sistema (dnf)..."
  dnf makecache -y
  dnf install -y ca-certificates curl gnupg2 git gcc-c++ make nginx firewalld certbot python3-certbot-nginx
}

install_node20() {
  if command -v node >/dev/null 2>&1 && node -v | grep -qE '^v20\.'; then
    return
  fi

  echo "[oracle-setup] Instalando Node.js 20..."
  if [[ "${PKG_MGR}" == "apt" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    return
  fi

  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  dnf install -y nodejs
}

configure_firewall() {
  echo "[oracle-setup] Configurando firewall..."
  if command -v ufw >/dev/null 2>&1; then
    ufw allow OpenSSH || true
    ufw allow 'Nginx Full' || true
    ufw --force enable || true
    return
  fi

  if command -v firewall-cmd >/dev/null 2>&1; then
    systemctl enable --now firewalld || true
    firewall-cmd --permanent --add-service=ssh || true
    firewall-cmd --permanent --add-service=http || true
    firewall-cmd --permanent --add-service=https || true
    firewall-cmd --reload || true
  fi
}

install_base_packages
install_node20

echo "[oracle-setup] Instalando PM2..."
npm install -g pm2

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  echo "[oracle-setup] Criando usuário ${APP_USER}..."
  useradd --create-home --shell /bin/bash "${APP_USER}"
fi

mkdir -p "${APP_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

configure_firewall

echo "[oracle-setup] Ambiente base pronto."
echo "[oracle-setup] Próximos passos:"
echo "  1) Clone o repo em ${APP_DIR} com o usuário ${APP_USER}"
echo "  2) Configure .env (produção) no servidor"
echo "  3) Copie scripts/oracle/nginx-autozap.conf.example para /etc/nginx/sites-available/autozap"
echo "  4) Rode deploy com: sudo -u ${APP_USER} APP_DIR=${APP_DIR} bash ${APP_DIR}/scripts/oracle/deploy.sh"
