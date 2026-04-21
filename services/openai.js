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
- Guarda de malas: pode ser organizada conforme disponibilidade.
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
- Se o hóspede perguntar sobre temas fora da hospedagem (ex: política, guerras, notícias, tecnologia, OpenAI, programação, curiosidades gerais), responda de forma educada redirecionando para hospedagem.
- Nestes casos, responda de forma breve como: "Posso te ajudar com tudo sobre a sua hospedagem na TorresGuest 😊 Me diga o que você precisa durante sua estadia."
- Nunca aprofunde ou continue conversas fora do contexto da hospedagem.
- Responda sempre no mesmo idioma do hóspede (português, inglês ou espanhol).
- Só encaminhe para humano quando for necessário.
– Quando o hospede perguntar sobre reserva, como alugar, site ou telefone para reservas, SEMPRE responda com: Sofia +55 13 99615-5505 e site www.torresguest.com.br. NUNCA invente numeros de telefone. NUNCA diga que nao pode fornecer o link do site.
- Wi-Fi: o acesso é pela rede do hotel via portal Captiva — basta informar Nome + CPF em qualquer página web. Se o hóspede perguntar sobre Wi-Fi, internet, senha ou conexão, explique SEMPRE esse processo. Nunca diga para buscar na recepção ou no material do flat.
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
  // Multi-tenant: se tenant tiver systemPrompt customizado, usa-lo; senao fallback para Torres hardcoded
  const basePrompt = (tenant && tenant.settings && tenant.settings.systemPrompt) || SYSTEM_PROMPT;
  const systemContent = profileBlock ? `${basePrompt}${profileBlock}` : basePrompt;
  const userInput = `${historyBlock}Telefone: ${phone}\nMensagem: ${userMessage}`;

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
      instructions: 'Fale em português do Brasil de forma natural, simpática e acolhedora, com ritmo mais rápido, fluido e com poucas pausas. Evite falar devagar ou robótico.',
    }),
  });
  if (!response.ok) { const errorText = await response.text(); throw new Error(`OpenAI speech failed: ${response.status} ${errorText}`); }
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { getChatGptFallbackReply, transcribeAudioBuffer, synthesizeSpeechBuffer };
