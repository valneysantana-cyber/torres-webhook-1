#!/usr/bin/env bash
# scripts/render-env-update.sh
#
# Atualiza UMA env var no service Render via PUT per-env (não bulk).
# Endpoint: PUT /v1/services/{id}/env-vars/{key}
#
# ⚠️ AVISO 02/06/2026: Render API tem comportamento BIZARRO em alguns
# momentos — PUT per-env pode causar OUTRA env (não a alvo) sumir
# silenciosamente. Causa ainda desconhecida. Salvaguardas detectam +
# abortam, mas precisa restaurar manualmente via dashboard se acontecer:
# https://dashboard.render.com/web/srv-d6srgcea2pns738drreg/env
#
# Por que NÃO usar PUT bulk (POST a /env-vars):
# Bug 02/06/2026 — bulk replace pode perder envs silenciosamente. MONGODB_URI
# sumiu numa PUT bulk e bot ficou 4h down. Per-env é mais seguro mas
# AINDA não é 100%. Caso real 02/06 16:25: ao adicionar WA_DAILY_REPORT_USE_TEMPLATE
# via per-env, ANTHROPIC_MODEL sumiu. Adicionar ANTHROPIC_MODEL fez LLM_PROVIDER
# sumir. Adicionar LLM_PROVIDER fez ANTHROPIC_API_KEY sumir.
#
# REGRA DE OURO: depois de QUALQUER mudança via este script, verificar lista
# completa de envs e restaurar manual se algo sumir.
#
# Uso:
#   ./scripts/render-env-update.sh <KEY> <VALUE>
#   ./scripts/render-env-update.sh WA_DAILY_REPORT_USE_TEMPLATE false
#
# Pré-requisitos:
#   - $RENDER_API_KEY no ambiente OU ~/.render_api_key
#   - jq instalado
#
# Salvaguardas:
#   1. Validar 5 envs CRÍTICAS presentes ANTES (MONGODB_URI, WHATSAPP_TOKEN,
#      ANTHROPIC_API_KEY, CRM_API_URL, CRM_API_KEY)
#   2. Count atual >= 18 envs (sanity)
#   3. PUT per-env (não toca outras)
#   4. Validar 5 envs CRÍTICAS presentes DEPOIS (deve continuar 100%)
#   5. Validar nossa env tem o valor enviado

set -euo pipefail

SERVICE_ID="srv-d6srgcea2pns738drreg"
CRITICAL_ENVS=("MONGODB_URI" "WHATSAPP_TOKEN" "ANTHROPIC_API_KEY" "CRM_API_URL" "CRM_API_KEY")
MIN_ENV_COUNT=18

if [ "$#" -ne 2 ]; then
  echo "ERR: uso: $0 <KEY> <VALUE>" >&2
  exit 1
fi

KEY="$1"
VALUE="$2"

RENDER_API_KEY="${RENDER_API_KEY:-}"
if [ -z "$RENDER_API_KEY" ] && [ -f "$HOME/.render_api_key" ]; then
  RENDER_API_KEY=$(cat "$HOME/.render_api_key" | tr -d '\n')
fi
if [ -z "$RENDER_API_KEY" ]; then
  echo "ERR: RENDER_API_KEY não encontrada" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERR: jq não instalado" >&2
  exit 1
fi

echo "== render-env-update (per-env, safe) =="
echo "  service:  $SERVICE_ID"
echo "  key:      $KEY"
echo "  value:    ${#VALUE} chars"
echo ""

# ── 1. GET estado atual ──
echo "[1/4] GET estado atual..."
BEFORE_JSON=$(curl -fsS -H "Authorization: Bearer ${RENDER_API_KEY}" \
  "https://api.render.com/v1/services/${SERVICE_ID}/env-vars")
BEFORE_COUNT=$(echo "$BEFORE_JSON" | jq 'length')
echo "  envs atuais: $BEFORE_COUNT"

if [ "$BEFORE_COUNT" -lt "$MIN_ENV_COUNT" ]; then
  echo "ABORT: count $BEFORE_COUNT < min $MIN_ENV_COUNT — estado anormal" >&2
  exit 2
fi

# ── 2. Validar envs CRÍTICAS presentes ANTES ──
echo "[2/4] Validar envs críticas..."
MISSING=()
for c in "${CRITICAL_ENVS[@]}"; do
  PRESENT=$(echo "$BEFORE_JSON" | jq -r --arg k "$c" '.[] | select(.envVar.key == $k) | .envVar.key')
  if [ -z "$PRESENT" ]; then
    MISSING+=("$c")
    echo "  ✗ $c AUSENTE"
  else
    echo "  ✓ $c"
  fi
done

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "ABORT: ${#MISSING[@]} env(s) crítica(s) ausente(s): ${MISSING[*]}" >&2
  echo "Restaurar manualmente antes de prosseguir." >&2
  exit 3
fi

# ── 3. PUT per-env (não toca outras) ──
echo "[3/4] PUT per-env /env-vars/${KEY}..."
PAYLOAD=$(jq -n --arg v "$VALUE" '{value: $v}')
HTTP=$(curl -s -X PUT -H "Authorization: Bearer ${RENDER_API_KEY}" -H "Content-Type: application/json" \
  "https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${KEY}" \
  -d "$PAYLOAD" -w '%{http_code}' -o /tmp/render_put_result.json)

if [ "$HTTP" != "200" ] && [ "$HTTP" != "201" ]; then
  echo "ABORT: HTTP $HTTP" >&2
  cat /tmp/render_put_result.json >&2
  exit 4
fi
echo "  HTTP $HTTP ✓"

# ── 4. Validar pós ──
echo "[4/4] Validar pós-PUT..."
sleep 2
AFTER_JSON=$(curl -fsS -H "Authorization: Bearer ${RENDER_API_KEY}" \
  "https://api.render.com/v1/services/${SERVICE_ID}/env-vars")
AFTER_COUNT=$(echo "$AFTER_JSON" | jq 'length')
echo "  envs após: $AFTER_COUNT"

# Esperar count >= BEFORE_COUNT (pode ser igual se update, +1 se nova)
if [ "$AFTER_COUNT" -lt "$BEFORE_COUNT" ]; then
  echo "ABORT: count caiu! $BEFORE_COUNT → $AFTER_COUNT — envs perdidas" >&2
  exit 5
fi

# Validar envs críticas presentes DEPOIS
for c in "${CRITICAL_ENVS[@]}"; do
  PRESENT=$(echo "$AFTER_JSON" | jq -r --arg k "$c" '.[] | select(.envVar.key == $k) | .envVar.key')
  if [ -z "$PRESENT" ]; then
    echo "ABORT: env crítica '$c' DESAPARECEU após PUT — investigar" >&2
    exit 6
  fi
done

# Validar nossa env tem o valor enviado
ACTUAL=$(echo "$AFTER_JSON" | jq -r --arg k "$KEY" '.[] | select(.envVar.key == $k) | .envVar.value')
if [ "$ACTUAL" != "$VALUE" ]; then
  echo "ABORT: $KEY tem valor diferente ('$(echo $ACTUAL | head -c 30)' != '$(echo $VALUE | head -c 30)')" >&2
  exit 7
fi

echo ""
echo "✅ OK — $KEY = '${VALUE:0:50}$( [ ${#VALUE} -gt 50 ] && echo '...' )' aplicado"
echo "  ${#CRITICAL_ENVS[@]} críticas confirmadas"
echo "  total $AFTER_COUNT envs (era $BEFORE_COUNT)"
echo ""
echo "Lembra: env nova requer deploy pra entrar em vigor."
echo "  ./scripts/render-deploy.sh   (ou via Render dashboard)"
