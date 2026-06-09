// Configuração do app. Em produção, aponte para a API do crm-server (atrás do nginx).
// Pode sobrescrever em runtime via localStorage.setItem('API_BASE', 'https://...').
(function () {
  // 1) override manual: localStorage.setItem('API_BASE','https://.../app/v1')
  // 2) navegador http(s): usa a mesma origin (funciona com o dev-server e atrás do nginx)
  // 3) app nativo (capacitor:// / file://): exige URL pública — AJUSTE aqui antes do build
  var stored = localStorage.getItem('API_BASE');
  var sameOrigin = (location.protocol === 'http:' || location.protocol === 'https:')
    ? location.origin + '/app/v1' : null;
  window.CC_CONFIG = {
    API_BASE: stored || sameOrigin || 'https://crm.conciergecloud.com.br/app/v1',
  };
})();
