#!/bin/bash
# deploy-app-api.sh — instala/atualiza a App API (/app/v1) no VPS.
# Segue o padrão do deploy.sh existente (wget dos arquivos do GitHub + pm2).
#
# Uso no VPS:
#   APP_JWT_SECRET=<segredo-forte> BRANCH=master bash deploy-app-api.sh
#
# Pré-requisitos: rodar com o PR #132 já mergeado em `master` (ou setar BRANCH=feat/app-operacao-vistorias).
set -e

BRANCH="${BRANCH:-master}"
APP_DIR="/root/torres-crm-api"
RAW="https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/${BRANCH}/crm-server"

cd "$APP_DIR"
echo "[deploy-app] branch=${BRANCH}"

echo "[deploy-app] baixando index.js (com a montagem do /app/v1)..."
wget -q -O index.js "${RAW}/index.js"

echo "[deploy-app] baixando módulo app-api/..."
mkdir -p app-api
for f in index.js auth.js ai.js inspections.js owner.js storage.js push.js seed.js; do
  wget -q -O "app-api/$f" "${RAW}/app-api/$f"
  echo "   + app-api/$f"
done

echo "[deploy-app] atualizando package.json e instalando dependências..."
wget -q -O package.json "${RAW}/package.json"
npm install --omit=dev --no-audit --no-fund

echo "[deploy-app] verificando variáveis de ambiente..."
touch .env
grep -q "^APP_JWT_SECRET=" .env || {
  if [ -n "$APP_JWT_SECRET" ]; then
    echo "APP_JWT_SECRET=${APP_JWT_SECRET}" >> .env
    echo "   + APP_JWT_SECRET adicionado ao .env"
  else
    echo "   !! APP_JWT_SECRET ausente — gere com: openssl rand -hex 32  e adicione ao .env"
  fi
}

echo "[deploy-app] reiniciando PM2..."
pm2 restart torres-crm-api --update-env

echo "[deploy-app] aguardando subir..."
sleep 3
echo "[deploy-app] healthcheck /app/v1/health:"
curl -s http://127.0.0.1:3001/app/v1/health || echo "(sem resposta — ver logs: pm2 logs torres-crm-api)"
echo ""
echo "[deploy-app] OK. Próximo: rodar o seed (uma vez):"
echo "   SEED_RESET_PW=1 SEED_PW_GLAUCO='...' SEED_PW_PROVIDER='...' SEED_PW_ADMIN='...' \\"
echo "   APP_JWT_SECRET=\$APP_JWT_SECRET node app-api/seed.js"
