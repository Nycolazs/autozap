#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/autozap}"
BRANCH="${BRANCH:-main}"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "[oracle-deploy] Diretório APP_DIR não existe: ${APP_DIR}" >&2
  exit 1
fi

cd "${APP_DIR}"

if [[ ! -f package.json ]]; then
  echo "[oracle-deploy] package.json não encontrado em ${APP_DIR}" >&2
  exit 1
fi

if [[ -d .git ]]; then
  echo "[oracle-deploy] Atualizando branch ${BRANCH}..."
  git fetch origin "${BRANCH}"
  git checkout "${BRANCH}"
  git pull --ff-only origin "${BRANCH}"
fi

if [[ ! -f .env ]]; then
  echo "[oracle-deploy] Arquivo .env não encontrado em ${APP_DIR}. Crie a configuração antes do deploy." >&2
  exit 1
fi

echo "[oracle-deploy] Instalando dependências..."
npm ci

echo "[oracle-deploy] Build Next.js..."
npm run build

echo "[oracle-deploy] Reiniciando API no PM2..."
pm2 startOrReload ./scripts/oracle/pm2.ecosystem.config.cjs --env production
pm2 save

echo "[oracle-deploy] Deploy concluído."
pm2 status autozap-api || true
