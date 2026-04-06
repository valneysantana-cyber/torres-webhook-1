#!/bin/bash
set -e
cd /root/torres-crm-api
echo "[deploy] Baixando campaigns.js..."
wget -q -O campaigns.js https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/master/crm-server/campaigns.js
echo "[deploy] Baixando index.js..."
wget -q -O index.js https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/master/crm-server/index.js
echo "[deploy] Atualizando .env..."
grep -q "RENDER_WEBHOOK_URL" .env 2>/dev/null || echo "RENDER_WEBHOOK_URL=https://torres-webhook-1.onrender.com" >> .env
echo "[deploy] Reiniciando PM2..."
pm2 restart torres-crm-api --update-env
echo "[deploy] Fase 3 OK!"
