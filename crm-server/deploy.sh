#!/bin/bash
set -e
cd /root/torres-crm-api
echo "[deploy] Baixando campaigns.js..."
wget -q -O campaigns.js https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/master/crm-server/campaigns.js
echo "[deploy] Baixando index.js..."
wget -q -O index.js https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/master/crm-server/index.js
echo "[deploy] Baixando search.html (painel campanhas)..."
mkdir -p public
wget -q -O public/search.html https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/master/crm-server/public/search.html
echo "[deploy] Baixando dashboard.html (painel anfitrião)..."
wget -q -O public/dashboard.html https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/master/crm-server/public/dashboard.html
echo "[deploy] Baixando afiliacoes.html (página admin Afiliações — também copiar pra /var/www/conciergecloud/ pra nginx servir static)..."
wget -q -O public/afiliacoes.html https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/master/crm-server/public/afiliacoes.html
cp -p public/afiliacoes.html /var/www/conciergecloud/afiliacoes.html 2>/dev/null && chown www-data:www-data /var/www/conciergecloud/afiliacoes.html 2>/dev/null || true
echo "[deploy] Baixando inventario.html (admin · Enxoval + Frigobar 8 quartos)..."
wget -q -O public/inventario.html https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/master/crm-server/public/inventario.html
echo "[deploy] Atualizando .env..."
grep -q "RENDER_WEBHOOK_URL" .env 2>/dev/null || echo "RENDER_WEBHOOK_URL=https://torres-webhook-1.onrender.com" >> .env
echo "[deploy] Reiniciando PM2..."
pm2 restart torres-crm-api --update-env
echo "[deploy] Fase 5 OK — painel campanhas ativo!"
