// Configuração do app. Em produção, aponte para a API do crm-server (atrás do nginx).
// Pode sobrescrever em runtime via localStorage.setItem('API_BASE', 'https://...').
(function () {
  // 1) override manual: localStorage.setItem('API_BASE','https://.../app/v1')
  // 2) navegador http(s): usa a mesma origin (funciona com o dev-server e atrás do nginx)
  // 3) app nativo (capacitor:// / file://): exige URL pública — AJUSTE aqui antes do build
  var stored = localStorage.getItem('API_BASE');
  // FIX 10/06: no Capacitor Android a WebView roda em https://localhost —
  // "mesma origem" apontava a API pro próprio aparelho. Exclui localhost.
  var isLocalWebview = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var sameOrigin = (!isLocalWebview && (location.protocol === 'http:' || location.protocol === 'https:'))
    ? location.origin + '/app/v1' : null;
  // Produção (atrás do nginx, /crm/ proxy → :3001, SEM auth_basic em /crm/app/v1):
  var PROD = 'https://conciergecloud.com.br/crm/app/v1';
  window.CC_CONFIG = {
    API_BASE: stored || sameOrigin || PROD,
  };
})();
