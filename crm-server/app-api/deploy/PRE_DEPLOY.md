# Pacote de Deploy — App API (/app/v1) no VPS

Deploy **aditivo**: não altera as rotas existentes do CRM. Reversível (basta reverter `index.js`).

## Ordem recomendada
1. **Merge do PR #132** em `master` (ou usar `BRANCH=feat/app-operacao-vistorias` no script para testar antes).
2. **Gerar o segredo JWT** (no VPS):
   ```bash
   openssl rand -hex 32      # copie o valor → será o APP_JWT_SECRET
   ```
3. **Rodar o deploy**:
   ```bash
   cd /root/torres-crm-api
   APP_JWT_SECRET='<valor-gerado>' BRANCH=master bash app-api/deploy/deploy-app-api.sh
   ```
   (na 1ª vez o script baixa também o próprio deploy; se preferir, baixe-o antes com `wget`.)
4. **nginx** (só se houver `auth_basic` no server): adicionar o bloco de `nginx-app-api.conf`
   antes do `location /`, depois `nginx -t && systemctl reload nginx`.
5. **Seed dos usuários** (uma vez), com senhas reais:
   ```bash
   SEED_RESET_PW=1 SEED_PW_ADMIN='...' SEED_PW_GLAUCO='...' SEED_PW_PROVIDER='...' \
   APP_JWT_SECRET='<valor>' node app-api/seed.js
   ```

## Variáveis de ambiente (.env do crm-server)
| Var | Quando | Observação |
|-----|--------|------------|
| `APP_JWT_SECRET` | **agora (obrigatória)** | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | p/ IA | já usada no projeto — confirmar presença |
| `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` | p/ fotos no R2 | sem elas, fotos ficam inline (ok p/ piloto) |
| `FIREBASE_SERVICE_ACCOUNT` | p/ push | sem ela, push vira no-op |

## Verificação pós-deploy
```bash
# 1) módulo no ar
curl -s http://127.0.0.1:3001/app/v1/health
# → {"ok":true,"module":"app-api",...}

# 2) login (após seed) devolve token
curl -s http://127.0.0.1:3001/app/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"g.vazflats@gmail.com","password":"<senha-do-seed>"}'

# 3) sem token → 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/app/v1/inspections
```

## Rollback
```bash
# reverter só o index.js para a versão anterior do master e reiniciar
wget -q -O index.js https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/<commit-anterior>/crm-server/index.js
pm2 restart torres-crm-api --update-env
```
As coleções novas (`app_users`, `inspections`, `app_devices`, `app_listings`) não afetam as existentes.

## Smoke test antes de produção (opcional, em staging/local)
```bash
cd crm-server && APP_JWT_SECRET=test npm run test:app   # 28/28 esperado
```
