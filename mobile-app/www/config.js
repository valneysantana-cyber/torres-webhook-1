// Configuração do app. Em produção, aponte para a API do crm-server (atrás do nginx).
// Pode sobrescrever em runtime via localStorage.setItem('API_BASE', 'https://...').
window.CC_CONFIG = {
  // Ex.: 'https://crm.conciergecloud.com.br/app/v1' — ajuste para a URL real do crm-server.
  API_BASE: localStorage.getItem('API_BASE') || 'http://localhost:3001/app/v1',
};
