# Guia de Credenciamento e Publicação — App ConciergeCloud

Passo a passo para colocar o app na **App Store (Apple)** e na **Google Play (Android)**.
Recomendação: tudo em nome de **organização (Torresguest LTDA)**, não pessoa física.

> ⚠️ **O que só você pode fazer** (exige sua identidade, cartão e 2FA): criar as contas,
> pagar as taxas, aceitar os contratos e clicar em "Enviar para revisão".
> **O que já está pronto no repositório:** código do app, ícone/splash, política de
> privacidade, textos e checklist das lojas.

---

## Etapa 0 — Pré-requisitos (uma vez)

### 0.1 Número D-U-N-S (gratuito, leva alguns dias)
Apple e Google exigem D-U-N-S para contas de organização.
1. Acesse o site da Apple para solicitar D-U-N-S (busque "Apple D-U-N-S Number lookup").
2. Informe os dados da **Torresguest LTDA** (CNPJ, razão social, endereço, telefone).
3. Aguarde o e-mail com o número (pode levar de 1 a 14 dias).

### 0.2 Ferramentas na sua máquina (Mac)
- **iOS:** instalar **Xcode** (App Store, gratuito, ~12 GB) e **CocoaPods** (`sudo gem install cocoapods`).
- **Android:** instalar **Android Studio** (inclui SDK) e **JDK 17** (o sistema hoje tem Java 8 — atualizar).
- **Node 18+** (já presente).

---

## Etapa 1 — Conta Apple Developer (US$ 99/ano)
1. Em `developer.apple.com/programs` → **Enroll**.
2. Escolha **Company / Organization** e informe o **D-U-N-S** da Torresguest.
3. Conclua a verificação (a Apple pode ligar para confirmar a empresa).
4. Pague a anuidade (US$ 99). Aprovação: ~1–2 dias.
5. Em `appstoreconnect.apple.com` → **Apps → +** → criar app:
   - Nome: **ConciergeCloud** · Bundle ID: `br.com.conciergecloud.app` · idioma primário: Português (Brasil).

## Etapa 2 — Conta Google Play Console (US$ 25, única vez)
1. Em `play.google.com/console` → criar conta **de organização**.
2. Informe os dados da Torresguest + D-U-N-S; conclua a **verificação de identidade da organização** (pode pedir documento).
3. Pague a taxa única (US$ 25).
4. **Criar app** → nome **ConciergeCloud**, app, gratuito.

---

## Etapa 3 — Gerar os projetos nativos (na sua máquina)
```bash
cd mobile-app
npm install
npx cap add ios          # requer Xcode + CocoaPods
npx cap add android      # requer Android Studio + JDK 17
npm run assets           # gera ícones/splash de todos os tamanhos a partir de assets/
# AJUSTE A API: em www/config.js, defina API_BASE para a URL pública do crm-server
npx cap sync
```

## Etapa 4 — iOS: build e envio
```bash
npx cap open ios         # abre o Xcode
```
No Xcode:
1. Selecione o **Team** (Torresguest) em Signing & Capabilities.
2. Em `Info.plist`, confirme as permissões (textos já sugeridos abaixo).
3. **Product → Archive** → **Distribute App → App Store Connect → Upload**.
4. No App Store Connect: preencha a ficha (use `store/LISTING.md`), anexe screenshots, política de privacidade, conta de teste, e **Enviar para revisão**.

**Permissões iOS (Info.plist) — textos:**
- `NSCameraUsageDescription`: "Usamos a câmera para fotografar os itens da vistoria."
- `NSLocationWhenInUseUsageDescription`: "Usamos sua localização apenas ao enviar uma vistoria, para confirmar a presença no imóvel."
- `NSPhotoLibraryAddUsageDescription`: "Para anexar fotos às vistorias."

## Etapa 5 — Android: build e envio
```bash
npx cap open android     # abre o Android Studio
```
No Android Studio:
1. **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**; crie/selene a **keystore** (guarde com segurança — é insubstituível).
2. No Play Console: crie uma **versão** (teste interno → produção), suba o `.aab`.
3. Preencha **Data safety** (use a tabela de `store/LISTING.md`), classificação de conteúdo, política de privacidade, **feature graphic 1024×500** e screenshots.
4. Envie para revisão (contas novas podem exigir um período de **teste fechado** antes da produção).

**Permissões Android** (o plugin já declara): `CAMERA`, `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`.

---

## Etapa 6 — Push (FCM) — quando for ativar
1. Crie um projeto no **Firebase** (console.firebase.google.com) com a Torresguest.
2. Android: baixe `google-services.json` → `android/app/`.
3. iOS: baixe `GoogleService-Info.plist` → adicione no Xcode; configure a **APNs Auth Key** no Firebase.
4. No servidor (`crm-server`), defina `FIREBASE_SERVICE_ACCOUNT` (JSON da service account) — o emissor já está implementado em `app-api/push.js`.

---

## Checklist final antes de enviar
- [ ] `www/config.js` apontando para a API pública (não localhost)
- [ ] Backend `/app/v1` no ar (deploy do PR) com `APP_JWT_SECRET` definido
- [ ] Usuários criados (rodar `seed`) e uma **conta de teste** para a revisão
- [ ] Política de privacidade publicada na URL
- [ ] Screenshots nas resoluções exigidas
- [ ] Ícone/splash gerados (`npm run assets`)
- [ ] (Opcional) `R2_*` e `FIREBASE_SERVICE_ACCOUNT` para fotos no R2 e push

## Tempo e custo (resumo)
| Item | Custo | Prazo típico |
|------|-------|--------------|
| D-U-N-S | Grátis | 1–14 dias |
| Apple Developer | US$ 99/ano | 1–2 dias |
| Google Play | US$ 25 (única) | 1–2 dias |
| Revisão Apple | — | 1–3 dias/envio |
| Revisão Google | — | 1–3 dias (+ teste fechado p/ conta nova) |
