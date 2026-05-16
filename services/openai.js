'use strict';

const {
  OPENAI_API_KEY,
  OPENAI_CHAT_MODEL,
  OPENAI_TRANSCRIBE_MODEL,
  OPENAI_TTS_MODEL,
  OPENAI_TTS_VOICE,
  HUMAN_NUMBER_PRIMARY,
  HUMAN_NUMBER_SECONDARY,
} = require('../config');

/**
 * Compõe o system prompt a partir de tenant.settings estruturados.
 * Usado quando o tenant NÃO é torres (que mantém SYSTEM_PROMPT hardcoded)
 * e NÃO tem settings.systemPrompt custom (override manual).
 *
 * Campos consumidos em tenant.settings:
 *   brandName, address, checkInTime, checkOutTime,
 *   breakfast, parking, reception, cleaning, internet, frigobar, restaurant, transport,
 *   acceptsPets, acceptsPetsNote, poolGymHours,
 *   reservationContact, reservationWebsite, humanEscalationNumber,
 *   contextNotes (array), customFaqs (array), signatureName
 */
function buildSystemPromptFromSettings(tenant) {
  const s = (tenant && tenant.settings) || {};
  const brand = s.brandName || 'nosso concierge';
  const lines = [];
  lines.push(`Você é o concierge virtual da ${brand}, com atendimento humano, cordial, elegante e objetivo.`);
  lines.push('Responda sempre no mesmo idioma do hóspede (português, inglês ou espanhol).');
  lines.push('Nunca invente informações.');
  lines.push('');
  lines.push('Contexto confiável da operação:');
  if (Array.isArray(s.contextNotes)) for (const n of s.contextNotes) lines.push(`- ${n}`);
  if (s.address) lines.push(`- Endereço oficial: ${s.address}.`);
  if (s.checkInTime) lines.push(`- Check-in: a partir das ${s.checkInTime}.`);
  if (s.checkOutTime) lines.push(`- Check-out: até ${s.checkOutTime}.`);
  if (s.breakfast) {
    const b = s.breakfast;
    if (b.enabled === false || b.type === 'none') lines.push('- Café da manhã: NÃO é oferecido na propriedade.');
    else {
      const prefix = b.type === 'included' ? 'INCLUSO na reserva' : b.type === 'paid' ? 'disponível (cobrança extra)' : 'disponível';
      lines.push(`- Café da manhã: ${prefix}${b.hours ? ', ' + b.hours : ''}${b.location ? ', no ' + b.location : ''}.${b.note ? ' ' + b.note : ''}`);
    }
  }
  if (s.restaurant && s.restaurant.available && s.restaurant.mealsBesidesBreakfast) {
    lines.push(`- Restaurante: ${s.restaurant.note || 'serve almoço e jantar sob consulta.'}`);
  }
  if (s.poolGymHours) lines.push(`- Piscina e academia: ${s.poolGymHours}.`);
  if (s.reception) {
    const r = s.reception;
    const map = { '24h-physical': 'Recepção e segurança 24 horas.', 'digital-facial': 'Check-in digital com reconhecimento facial.', 'digital-code': 'Check-in digital via código enviado no WhatsApp.', 'scheduled': 'Recepção em horário agendado.' };
    lines.push(`- ${map[r.type] || r.note || 'Recepção disponível.'}${r.note && map[r.type] ? ' ' + r.note : ''}`);
  }
  if (s.parking) {
    const p = s.parking;
    if (p.type === 'none') lines.push('- Estacionamento: NÃO oferecido no prédio.');
    else if (p.type === 'valet-included') lines.push(`- Estacionamento com manobrista${p.location ? ' ' + p.location : ''}, sem custo adicional.${p.note ? ' ' + p.note : ''}`);
    else if (p.type === 'valet-paid') lines.push(`- Estacionamento com manobrista${p.location ? ' ' + p.location : ''}${p.cost ? ', custo ' + p.cost : ''}.${p.note ? ' ' + p.note : ''}`);
    else if (p.type === 'external') lines.push(`- Estacionamento: EXTERNO${p.location ? ', localizado em ' + p.location : ''}${p.cost ? ', custo ' + p.cost : ''}.${p.note ? ' ' + p.note : ''}`);
  }
  if (s.cleaning) {
    const c = s.cleaning;
    const map = { daily: 'diária', onrequest: 'sob demanda', weekly: 'semanal' };
    lines.push(`- Limpeza: ${map[c.type] || c.type}${c.provider ? ' realizada pela ' + c.provider : ''}.${c.note ? ' ' + c.note : ''}`);
  }
  if (s.internet) {
    const i = s.internet;
    const map = { 'captive-portal': 'Wi-Fi via portal cativo (requer cadastro simples)', 'open': 'Wi-Fi aberto sem senha', 'password': 'Wi-Fi com senha — fornecida no check-in', 'none': 'Sem Wi-Fi no flat' };
    lines.push(`- Internet: ${map[i.type] || i.type}.${i.note ? ' ' + i.note : ''}`);
  }
  if (s.frigobar && s.frigobar.enabled) {
    lines.push(`- Frigobar: abastecido.${s.frigobar.note ? ' ' + s.frigobar.note : ''}`);
  }
  if (s.transport && s.transport.taxiAvailable) {
    lines.push(`- Transporte: ${s.transport.note || 'táxi/transfer sob consulta.'}`);
  }
  if (s.acceptsPets === false) lines.push(`- ${s.acceptsPetsNote || 'Não aceitamos pets no estabelecimento.'}`);
  if (s.reservationContact || s.reservationWebsite) {
    lines.push(`- Reservas e informações: ${s.reservationContact ? 'WhatsApp ' + s.reservationContact : ''}${s.reservationContact && s.reservationWebsite ? ' ou ' : ''}${s.reservationWebsite ? 'site ' + s.reservationWebsite : ''}.`);
  }
  if (s.landmarks && typeof s.landmarks === "object" && Object.keys(s.landmarks).length) {
    lines.push("");
    lines.push("Pontos de referencia REAIS proximos com distancias precisas (use SEMPRE estes valores, NUNCA invente):");
    for (const [slug, l] of Object.entries(s.landmarks)) {
      if (!l || typeof l !== "object") continue;
      const dist = l.distance_m ? l.distance_m + "m" : l.distance_km ? l.distance_km + "km" : "?";
      const time = l.walk_min ? `, ${l.walk_min}min a pe` : "";
      const uber = l.uber_brl ? `, Uber R$${l.uber_brl}` : "";
      const metro = l.metro ? `, metro: ${l.metro}` : "";
      const note = l.note ? ` ${l.note}` : "";
      lines.push(`- ${l.name || slug}: ${dist}${time}${uber}${metro}.${note}`);
    }
    lines.push("- REGRA: se o hospede perguntar distancia/tempo/Uber para um destes pontos, use EXATAMENTE estes valores acima. Nao chute.");
  }
  if (Array.isArray(s.customFaqs) && s.customFaqs.length) {
    lines.push('');
    lines.push('Perguntas e respostas específicas desta propriedade:');
    for (const f of s.customFaqs) if (f.question && f.answer) lines.push(`- Se perguntar "${f.question}": ${f.answer}`);
  }
  lines.push('');
  lines.push('Regras:');
  lines.push('- ⚠️ REGRA CRÍTICA — CONTATO HUMANO: NUNCA invente ou recupere números de telefone do contexto. Se user pedir contato (falar com Valney, Sofia, fundador, atendente, humano, time comercial, suporte), use APENAS este número fixo: WhatsApp Sofia +55 13 99615-5505 (link wa.me/5513996155505). NUNCA use o número do remetente como contato. Se você não tem certeza absoluta de um número, NÃO INVENTE — apenas direcione pra Sofia.');
  lines.push('- Nunca comece respostas com "Olá", "Oi", "Bom dia", "Boa tarde" ou qualquer saudação.');
  lines.push('- Responda direto ao ponto, de forma natural, como uma conversa contínua.');
  lines.push('- Responda de forma curta, útil, natural e acolhedora.');
  lines.push('- O atendimento deve ser 100% focado em hospedagem, turismo, estadia, estrutura e região.');
  lines.push('- Se o hóspede perguntar sobre temas fora da hospedagem, redirecione educadamente.');
  lines.push('- Só encaminhe para humano quando for estritamente necessário.');
  lines.push('- Antecipação de chegada de acompanhante: se o titular avisar que outra pessoa da MESMA reserva chegará antes dele(a) ou pedir acesso sem sua presença, NÃO negue. Acolha e oriente o(a) titular a encaminhar pra acompanhante o link de pré-checkin da reserva — o formulário coleta documento com foto, nome completo e horário de chegada, e a recepção é avisada automaticamente. Nunca recomende que o(a) acompanhante "aguarde" o titular.');
  lines.push('');
  lines.push('Estilo de fala (importante porque suas respostas viram áudio):');
  lines.push('- Use português falado, não escrito. Contrações naturais: "tô", "pra", "tá", "cê" quando soar bem. Evite "estou", "para", "está" se a frase ficar mais natural com a contração.');
  lines.push('- Frases curtas, no máximo 15 palavras cada. Quebre ideias grandes em duas ou três frases.');
  lines.push('- Use vírgulas pra dar ritmo de fala. Ex: "claro, posso te ajudar" em vez de "claro posso te ajudar".');
  lines.push('- Evite jargão corporativo: troque "ofereço", "disponibilizamos", "no momento" por "tem", "rola", "agora".');
  lines.push('- Comece direto na resposta, sem preâmbulo. Ex: "tem sim, tá disponível das 8 às 9 da noite" em vez de "Informo que sim, está disponível...".');
  lines.push('- Soe como concierge humano simpático, não como manual de hotel.');
  if (s.humanEscalationNumber) lines.push(`- Se precisar escalar pra humano, o número é ${s.humanEscalationNumber}.`);
  return lines.join('\n');
}

const SYSTEM_PROMPT = `
Você é o concierge virtual da TorresGuest, com atendimento humano, cordial, elegante e objetivo.
Responda sempre no mesmo idioma do hóspede (português, inglês ou espanhol).
Nunca invente informações.

Contexto confiável da operação:
- TorresGuest opera flats particulares dentro de um hotel em Perdizes, São Paulo/SP.
- Próximo ao Allianz Parque, PUC-SP e Shopping Bourbon.
- Café da manhã: INCLUSO na reserva, todos os dias, das 06h30 às 10h00, no restaurante do lobby.
- Restaurante: além do café da manhã incluso, o restaurante serve também almoço e jantar à la carte, sob consulta, com ótimos preços.
- Piscina e academia: todos os dias, das 08h00 às 21h00.
- Check-in: a partir das 14h.
- Check-out: até 12h.
- Recepção e segurança: 24 horas.
- Estacionamento com manobrista dentro do prédio, sem custo adicional para hóspedes.
- Táxi e translado: disponível sob consulta, com custo informado conforme o destino. Temos o motorista Robson disponível — podemos fazer uma cotação para o hóspede. NUNCA diga que vai ligar, agendar ou solicitar táxi por conta própria.
- Limpeza/governança: a equipe realiza limpeza DIÁRIA, incluindo coleta de lixo. O hóspede não precisa deixar lixo no corredor — a equipe cuida de tudo na limpeza diária.
- Guarda de malas: temos acordo com o Sr. Alberto, chefe do restaurante (acesso pelo lobby), que guarda as malas dos nossos hóspedes antes do check-in ou depois do check-out conforme disponibilidade. Quando hóspede pedir pra deixar bagagem, mencione o Sr. Alberto e peça horário pra alinhar com ele. NUNCA responda genericamente "a equipe vai cuidar".
- Chegadas de madrugada são possíveis, pois a recepção funciona 24 horas.
- Endereço oficial: Rua Monte Alegre, 835 - Perdizes, São Paulo - SP.
- Reservas e informacoes: contatar a Sofia pelo WhatsApp +55 13 99615-5505 ou pelo site www.torresguest.com.br.

Regras:
- Sempre que o hóspede perguntar endereço, localização ou como chegar, responda EXATAMENTE: "Rua Monte Alegre, 835 - Perdizes, São Paulo - SP."
- Nunca informe outro endereço.
- Nunca comece respostas com "Olá", "Oi", "Bom dia", "Boa tarde" ou qualquer saudação.
- Responda direto ao ponto, de forma natural, como uma conversa contínua.
- Responda de forma curta, útil, natural e acolhedora.
- Sempre tente responder diretamente.
- O atendimento deve ser 100% focado em hospedagem, turismo, estadia, estrutura do hotel e região de Perdizes.
- Nunca responda ou desenvolva assuntos fora desse contexto.
- IMPORTANTE — sobre o produto-mãe ConciergeCloud: ConciergeCloud é a empresa de tecnologia (SaaS) que opera o bot WhatsApp pra anfitriões Airbnb. TorresGuest é cliente desse software. Quando user perguntar "o que é conciergecloud", "me fale sobre conciergecloud", "como funciona o conciergecloud", "quanto custa o conciergecloud", responda explicando: software de atendimento 24/7 em 4 idiomas pra anfitriões Airbnb/Booking/Expedia, com Stays integrado, R$145/mês, setup em 5min. Site: https://conciergecloud.com.br. Sofia: wa.me/5513996155505.
- Se user disser explicitamente "não estou hospedado", "não sou hóspede", "ainda vou reservar", "quero conhecer", "quero contratar" — pivote pra modo informativo: explique TorresGuest E ConciergeCloud naturalmente, sem repetir "te ajudo com sua hospedagem". Trate como prospect interessado, não como hóspede ativo.
- Se user fizer META-pergunta ("porque está falando assim", "porque essa resposta", "não foi isso que perguntei") — RECONHEÇA o feedback, ajuste o tom, peça pra reformular. NÃO repita a resposta-padrão. Exemplo: "desculpa, te entendi errado. me ajuda com a pergunta específica?"
- Pra perguntas claramente OFF-TOPIC EXTREMAS (política, guerra, religião, OpenAI, programação não-relacionada), redirecione educadamente. Apenas nesses casos use redirect curto. NÃO use o redirect pra perguntas legítimas sobre o negócio/produto/operação.
- Responda sempre no mesmo idioma do hóspede (português, inglês ou espanhol).
- Só encaminhe para humano quando for necessário.
– Quando o hospede perguntar sobre reserva, como alugar, site ou telefone para reservas, SEMPRE responda com: Sofia +55 13 99615-5505 e site www.torresguest.com.br. NUNCA invente numeros de telefone. NUNCA diga que nao pode fornecer o link do site.
- ⚠️ REGRA CRÍTICA — CONTATO HUMANO: Quando user pedir contato (falar com Valney, Sofia, fundador, atendente, humano, time, suporte, comercial, vendas, qualquer pessoa), use APENAS este número fixo: WhatsApp Sofia +55 13 99615-5505 (link wa.me/5513996155505). NUNCA use o número do remetente como contato — ele NUNCA aparece no contexto da mensagem, então se você mencionar "+55 11 99..." ou qualquer outro número que não seja a Sofia, é alucinação. Resposta-padrão: "te conecto com a Sofia, nosso atendimento humano: wa.me/5513996155505 — ela responde rapidinho e te ajuda no que precisar."
- REGRA CRÍTICA — Pedidos que dependem de aprovação operacional (late checkout / saída depois das 12h, early check-in / entrada antes das 14h, troca de quarto, mudança de reserva, prorrogação da estadia, decoração especial, refund/reembolso, autorização de visita, qualquer pedido fora do padrão): você NÃO tem capacidade de aprovar, consultar o anfitrião nem voltar depois. NUNCA prometa "vou verificar", "vou confirmar", "um momento", "já te aviso", "vou checar com a equipe" — isso é alucinação porque você é stateless. Nesses casos, responda EXATAMENTE neste padrão: informe a regra padrão (ex: "checkout é até 12h"), explique que pra avaliar exceção precisa falar com a Sofia, e passe o WhatsApp dela: +55 13 99615-5505. Exemplo correto pra "posso fazer checkout às 14h?": "checkout é até 12h. pra avaliar uma extensão, fala com a Sofia no WhatsApp +55 13 99615-5505 — ela consegue confirmar com a equipe."
- Wi-Fi: o acesso é pela rede do hotel via portal Captiva — basta informar Nome + CPF em qualquer página web. Se o hóspede perguntar sobre Wi-Fi, internet, senha ou conexão, explique SEMPRE esse processo. Nunca diga para buscar na recepção ou no material do flat.
- Antecipação de chegada de acompanhante: se o titular avisar que outra pessoa da MESMA reserva chegará antes dele(a) ou pedir acesso sem sua presença, NÃO negue. Acolha e oriente o(a) titular a encaminhar pra acompanhante o link de pré-checkin da reserva (formato https://conciergecloud.com.br/checkin/{codigo_da_reserva}) — o formulário coleta documento com foto, nome completo e horário de chegada, e a recepção é avisada automaticamente. Nunca recomende que o(a) acompanhante "aguarde" o titular.

Estilo de fala (importante porque suas respostas viram áudio quando o hospede manda audio):
- Use português falado, não escrito. Contrações naturais: "tô", "pra", "tá", "cê" quando soar bem. Evite "estou", "para", "está" se a frase ficar mais natural com a contração.
- Frases curtas, no máximo 15 palavras cada. Quebre ideias grandes em duas ou três frases.
- Use vírgulas pra dar ritmo de fala. Ex: "claro, posso te ajudar" em vez de "claro posso te ajudar".
- Evite jargão corporativo: troque "ofereço", "disponibilizamos", "no momento" por "tem", "rola", "agora".
- Comece direto na resposta, sem preâmbulo. Ex: "tem sim, tá disponível das 8 às 9 da noite" em vez de "Informo que sim, está disponível...".
- Soe como concierge humano simpático, não como manual de hotel.
`.trim();

/**
 * Build conversation history block from CRM context messages.
 * @param {Array<{role: string, content: string}>} context
 * @returns {string}
 */
function buildHistoryBlock(context) {
  if (!context || context.length === 0) return '';
  const lines = context
    .slice(-8)
    .map((m) => {
      const label = m.role === 'assistant' ? 'Assistente' : 'Hóspede';
      return `[${label}]: ${m.content}`;
    })
    .join('\n');
  return `Histórico recente da conversa:\n${lines}\n\n`;
}

/**
 * Behavior instructions per loyalty level.
 * Injected into the GPT system prompt via buildProfileBlock.
 */
const LEVEL_BENEFITS = {
  Visitante: '',
  Frequente: 'Hóspede que já retornou ao TorresGuest. Mencione que é um prazer tê-lo de volta.',
  VIP: 'Hóspede VIP. Use o nome se souber. Demonstre que o hotel o conhece e valoriza muito sua fidelidade.',
  Embaixador: 'Hóspede EMBAIXADOR — o mais fiel de todos. Máxima personalização, mencione sua lealdade e quanto ele é especial para o TorresGuest.',
};

/**
 * Build guest loyalty profile block to inject into the system prompt.
 * @param {Object|null} profile Guest profile from CRM
 * @returns {string}
 */
function buildProfileBlock(profile) {
  if (!profile) return '';
  const lines = [];
  if (profile.name) lines.push(`Nome do hóspede: ${profile.name}`);
  if (profile.level) lines.push(`Nível de fidelidade: ${profile.level}`);
  if (profile.totalStays) lines.push(`Total de estadias: ${profile.totalStays}`);
  if (profile.totalNights) lines.push(`Total de noites hospedado: ${profile.totalNights}`);
  if (profile.preferredApartment) lines.push(`Apartamento preferido: ${profile.preferredApartment}`);
  if (profile.notes) lines.push(`Observações: ${profile.notes}`);
  const levelInstruction = profile.level && LEVEL_BENEFITS[profile.level];
  if (levelInstruction) lines.push(`Instrução de atendimento: ${levelInstruction}`);
  if (!lines.length) return '';
  return `\n\nPerfil do hóspede (use para personalizar o atendimento):\n${lines.join('\n')}`;
}

/**
 * Get a reply from ChatGPT for a guest message.
 * @param {string} userMessage The current message from the guest
 * @param {string} phone Guest phone number
 * @param {Array} context Previous messages from CRM (oldest first)
 * @param {Object|null} profile Guest loyalty profile from CRM
 */
async function getChatGptFallbackReply(userMessage, phone, context = [], profile = null, tenant = null) {
  if (!OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY'); return null; }

  const historyBlock = buildHistoryBlock(context);
  const profileBlock = buildProfileBlock(profile);
  // Multi-tenant: prioridade
  //  1. settings.systemPrompt custom (override manual pelo admin)
  //  2. se tenant tem settings estruturadas e NÃO é torres → builder dinâmico
  //  3. fallback SYSTEM_PROMPT (torres hardcoded, estabilidade)
  let basePrompt;
  if (tenant && tenant.settings && tenant.settings.systemPrompt) {
    basePrompt = tenant.settings.systemPrompt;
  } else if (tenant && tenant.tenantId && tenant.tenantId !== 'torres' && tenant.settings) {
    basePrompt = buildSystemPromptFromSettings(tenant);
  } else {
    basePrompt = SYSTEM_PROMPT;
  }
  // Append landmarks REAIS do tenant.settings (vale para QUALQUER tenant incluindo torres
  // hardcoded). Sem isso, LLM hallucina distancias quando hospede pergunta.
  if (tenant && tenant.settings && tenant.settings.landmarks && typeof tenant.settings.landmarks === 'object') {
    const ldkeys = Object.keys(tenant.settings.landmarks);
    if (ldkeys.length) {
      const lmLines = [];
      lmLines.push('');
      lmLines.push('Pontos de referencia REAIS proximos com distancias precisas — USE EXATAMENTE estes valores, NUNCA invente:');
      for (const [slug, l] of Object.entries(tenant.settings.landmarks)) {
        if (!l || typeof l !== 'object') continue;
        const dist = l.distance_m ? l.distance_m + 'm' : l.distance_km ? l.distance_km + 'km' : '?';
        const time = l.walk_min ? ', ' + l.walk_min + 'min a pe' : '';
        const uber = l.uber_brl ? ', Uber R$' + l.uber_brl : '';
        const metro = l.metro ? ', metro: ' + l.metro : '';
        const note = l.note ? ' ' + l.note : '';
        lmLines.push('- ' + (l.name || slug) + ': ' + dist + time + uber + metro + '.' + note);
      }
      lmLines.push('- REGRA: Se hospede perguntar distancia/tempo/Uber para um destes pontos, use exatamente os valores acima. Nao chute, nao arredonde.');
      basePrompt = basePrompt + '\n' + lmLines.join('\n');
    }
  }
  // Tambem garante endereco real se nao estiver ja embutido no prompt
  if (tenant && tenant.settings && (tenant.settings.address_full || tenant.settings.address)) {
    const addr = tenant.settings.address_full || tenant.settings.address;
    if (!basePrompt.includes(addr)) {
      basePrompt = basePrompt + '\n\nEndereco oficial do hotel: ' + addr + '. (Use este endereco quando hospede pedir endereco/localizacao/onde fica.)';
    }
  }
  const systemContent = profileBlock ? `${basePrompt}${profileBlock}` : basePrompt;
  // ⚠️ NÃO incluir o phone do remetente no userInput — AI alucina usando-o como
  // contato humano quando user pede "fala com o Valney/Sofia/atendente". Bug
  // descoberto 08/05/2026: bot retornou "WhatsApp do Valney: <phone do user>"
  // pra prospect cc_sales que perguntou contato. Phone é metadata, não conteúdo.
  const userInput = `${historyBlock}Mensagem: ${userMessage}`;

  // ── PROVIDER SWITCH: anthropic | openai ──
  if (LLM_PROVIDER === 'anthropic' && ANTHROPIC_API_KEY) {
    try {
      const client = getAnthropicClient();
      if (!client) throw new Error('Anthropic client not initialized');
      const userText = (typeof userInput === 'string') ? userInput : (Array.isArray(userInput) ? userInput.map(p=>p.text||'').join('\n') : String(userInput));
      const msg = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 600,
        system: systemContent,
        messages: [{ role: 'user', content: userText }],
      });
      const text = (msg.content && msg.content[0] && msg.content[0].text) || '';
      console.log('[anthropic reply]', text.slice(0, 200));
      return text.trim() || null;
    } catch (err) {
      console.error('[anthropic] erro, fallback pra openai:', err.message);
      // continua pro OpenAI abaixo
    }
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemContent }] },
        { role: 'user', content: [{ type: 'input_text', text: userInput }] },
      ],
    }),
  });

  const raw = await response.text();
  console.log('[openai fallback raw]', raw.slice(0, 500));
  if (!response.ok) { console.error('OpenAI fallback failed', response.status, raw); return null; }

  let data;
  try { data = JSON.parse(raw); } catch (err) { console.error('Failed to parse JSON', err); return null; }

  if (data.output_text && data.output_text.trim()) return data.output_text.trim();
  return (
    data.output
      ?.flatMap((item) => item.content || [])
      ?.map((item) => item.text || '')
      ?.join(' ')
      ?.trim() || null
  );
}

async function transcribeAudioBuffer(buffer, mimeType = 'audio/ogg') {
  if (!OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY'); return null; }
  const form = new FormData();
  const ext = mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('wav') ? 'wav' : 'ogg';
  form.append('file', new Blob([buffer], { type: mimeType }), `guest-audio.${ext}`);
  form.append('model', OPENAI_TRANSCRIBE_MODEL);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!response.ok) { const errorText = await response.text(); throw new Error(`OpenAI transcription failed: ${response.status} ${errorText}`); }
  const data = await response.json();
  return data?.text?.trim() || null;
}

async function synthesizeSpeechBuffer(text) {
  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: text,
      format: 'mp3',
      instructions: [
        'Você é a voz de um(a) concierge brasileiro(a) acolhendo um(a) hóspede pelo WhatsApp.',
        'Fale em português do Brasil com sotaque paulistano natural, jamais com sotaque estrangeirizado.',
        'Tom: caloroso, próximo, com sorriso na voz — como quem conversa, não quem lê um script.',
        'Ritmo: levemente acelerado e fluido, com leves pausas em vírgulas e pausa um pouco maior em pontos finais. Evite pausas longas entre palavras.',
        'Entonação: varie naturalmente — suba na pergunta, desça em afirmações tranquilizadoras. Nunca monótona.',
        'Pronuncie números e horários como na fala real: "duas da tarde" e não "14 horas"; "cento e cinquenta reais" e não "150 reais".',
        'Emojis e símbolos no texto NÃO devem ser falados — ignore.',
        'Não soletre URLs nem códigos longos; mencione brevemente "te mandei o link aqui no chat".',
      ].join(' '),
    }),
  });
  if (!response.ok) { const errorText = await response.text(); throw new Error(`OpenAI speech failed: ${response.status} ${errorText}`); }
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { getChatGptFallbackReply, transcribeAudioBuffer, synthesizeSpeechBuffer };
