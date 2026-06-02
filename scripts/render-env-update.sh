#!/usr/bin/env bash
# scripts/render-env-update.sh
#
# Atualiza UMA env var no service Render via PUT per-env (não bulk).
# Endpoint: PUT /v1/services/{id}/env-vars/{key}
#
# ⚠️ NOTA IMPORTANTE 02/06/2026 sobre Render API:
# O endpoint LIST `GET /env-vars` retorna lista incompleta/stale — não é
# fonte de verdade. O endpoint INDIVIDUAL `GET /env-vars/{key}` SIM é fonte
# de verdade. Por isso esse script valida cada CRITICAL_ENV via GET
# individual (não pela lista). Falso alarme do incident 02/06 16:25 levou
# a essa descoberta.
#
# Por que NÃO usar PUT bulk (POST a /env-vars):
# Bug 02/06/2026 — bulk replace PODE perder envs (não comprovado mas evidência
# circumstancial). MONGODB_URI sumiu numa PUT bulk e bot ficou 4h down. PUT
# per-env é mais seguro porque só toca a env alvo.
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

# ── 1. Validar envs CRÍTICAS via GET INDIVIDUAL (fonte de verdade) ──
# Render API LIST endpoint tem bug intermitente: retorna lista incompleta/stale.
# GET individual /env-vars/{key} é a fonte de verdade real.
echo "[1/3] Validar envs críticas (GET individual)..."
MISSING=()
for c in "${CRITICAL_ENVS[@]}"; do
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    "https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${c}")
  if [ "$HTTP" = "200" ]; then
    echo "  ✓ $c"
  else
    MISSING+=("$c")
    echo "  ✗ $c AUSENTE (HTTP $HTTP)"
  fi
done

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "ABORT: ${#MISSING[@]} env(s) crítica(s) ausente(s): ${MISSING[*]}" >&2
  echo "Restaurar manualmente via dashboard antes de prosseguir." >&2
  exit 3
fi

# ── 2. PUT per-env (não toca outras) ──
echo "[2/3] PUT per-env /env-vars/${KEY}..."
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

# ── 3. Validar pós (GET INDIVIDUAL — único confiável) ──
echo "[3/3] Validar pós-PUT (GET individual)..."
sleep 2

# Validar nossa env tem o valor enviado
APPLIED=$(curl -fsS -H "Authorization: Bearer ${RENDER_API_KEY}" \
  "https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${KEY}" | jq -r '.value')
if [ "$APPLIED" != "$VALUE" ]; then
  echo "ABORT: $KEY valor aplicado != enviado ('$(echo $APPLIED | head -c 30)' != '$(echo $VALUE | head -c 30)')" >&2
  exit 5
fi
echo "  $KEY valor confirmado ✓"

# Validar todas críticas continuam presentes (GET individual)
for c in "${CRITICAL_ENVS[@]}"; do
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    "https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${c}")
  if [ "$HTTP" != "200" ]; then
    echo "ABORT: env crítica '$c' DESAPARECEU após PUT (HTTP $HTTP) — investigar" >&2
    exit 6
  fi
done

echo ""
echo "✅ OK — $KEY = '${VALUE:0:50}$( [ ${#VALUE} -gt 50 ] && echo '...' )' aplicado"
echo "  ${#CRITICAL_ENVS[@]} críticas confirmadas via GET individual"
echo ""
echo "Lembra: env nova requer DEPLOY pra entrar em vigor (não apenas restart)."
echo "  curl -X POST -H 'Authorization: Bearer \$RENDER_API_KEY' \\"
echo "    https://api.render.com/v1/services/${SERVICE_ID}/deploys -d '{\"clearCache\":\"do_not_clear\"}'"
