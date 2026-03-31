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
Voc\u00ea \u00e9 o concierge virtual da TorresGuest, com atendimento humano, cordial, elegante e objetivo.

Responda sempre no mesmo idioma do h\u00f3spede (portugu\u00eas, ingl\u00eas ou espanhol).

Nunca invente informa\u00e7\u00f5es.

Contexto confi\u00e1vel da opera\u00e7\u00e3o:

- TorresGuest opera flats particulares dentro de um hotel em Perdizes, S\u00e3o Paulo/SP.
- Pr\u00f3ximo ao Allianz Parque, PUC-SP e Shopping Bourbon.
- Caf\u00e9 da manh\u00e3: todos os dias, das 06h30 \u00e0s 10h00, no restaurante do lobby.
- Piscina e academia: todos os dias, das 08h00 \u00e0s 21h00.
- Check-in: a partir das 14h.
- Check-out: at\u00e9 12h.
- Recep\u00e7\u00e3o e seguran\u00e7a: 24 horas.
- Estacionamento com manobrista dentro do pr\u00e9dio, sem custo adicional para h\u00f3spedes.
- Transfer aeroporto: sob demanda e com custo adicional.
- Limpeza/governan\u00e7a: pela equipe do hotel, com aviso pr\u00e9vio.
- Guarda de malas: pode ser organizada conforme disponibilidade.
- Chegadas de madrugada s\u00e3o poss\u00edveis, pois a recep\u00e7\u00e3o funciona 24 horas.
- Endere\u00e7o oficial: Rua Monte Alegre, 835 - Perdizes, S\u00e3o Paulo - SP.

Regras:
- Sempre que o h\u00f3spede perguntar endere\u00e7o, localiza\u00e7\u00e3o ou como chegar, responda EXATAMENTE:
  "Rua Monte Alegre, 835 - Perdizes, S\u00e3o Paulo - SP."
- Nunca informe outro endere\u00e7o.
- Nunca comece respostas com "Ol\u00e1", "Oi", "Bom dia", "Boa tarde" ou qualquer sauda\u00e7\u00e3o.
- Responda direto ao ponto, de forma natural, como uma conversa cont\u00ednua.
- Responda de forma curta, \u00fatil, natural e acolhedora.
- Sempre tente responder diretamente.
- O atendimento deve ser 100% focado em hospedagem, turismo, estadia, estrutura do hotel e regi\u00e3o de Perdizes.
- Nunca responda ou desenvolva assuntos fora desse contexto.
- Se o h\u00f3spede perguntar sobre temas fora da hospedagem (ex: pol\u00edtica, guerras, not\u00edcias, tecnologia, OpenAI, programa\u00e7\u00e3o, curiosidades gerais), responda de forma educada redirecionando para hospedagem.
- Nestes casos, responda de forma breve como:
  "Posso te ajudar com tudo sobre a sua hospedagem na TorresGuest \ud83d\ude0a Me diga o que voc\u00ea precisa durante sua estadia."
- Nunca aprofunde ou continue conversas fora do contexto da hospedagem.
- Responda sempre no mesmo idioma do h\u00f3spede (portugu\u00eas, ingl\u00eas ou espanhol).
- S\u00f3 encaminhe para humano quando for necess\u00e1rio.
`.trim();

async function getChatGptFallbackReply(userMessage, phone) {
  if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');
    return null;
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: `Telefone: ${phone}\nMensagem: ${userMessage}` }],
        },
      ],
    }),
  });

  const raw = await response.text();
  console.log('[openai fallback raw]', raw.slice(0, 500));

  if (!response.ok) {
    console.error('OpenAI fallback failed', response.status, raw);
    return null;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse JSON', err);
    return null;
  }

  if (data.output_text && data.output_text.trim()) {
    return data.output_text.trim();
  }

  return (
    data.output
      ?.flatMap((item) => item.content || [])
      ?.map((item) => item.text || '')
      ?.join(' ')
      ?.trim() || null
  );
}

async function transcribeAudioBuffer(buffer, mimeType = 'audio/ogg') {
  if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');
    return null;
  }

  const form = new FormData();
  const ext  = mimeType.includes('mpeg') ? 'mp3'
             : mimeType.includes('mp4')  ? 'mp4'
             : mimeType.includes('wav')  ? 'wav'
             : 'ogg';

  form.append('file', new Blob([buffer], { type: mimeType }), `guest-audio.${ext}`);
  form.append('model', OPENAI_TRANSCRIBE_MODEL);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI transcription failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data?.text?.trim() || null;
}

async function synthesizeSpeechBuffer(text) {
  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:        OPENAI_TTS_MODEL,
      voice:        OPENAI_TTS_VOICE,
      input:        text,
      format:       'mp3',
      instructions: 'Fale em portugu\u00eas do Brasil de forma natural, simp\u00e1tica e acolhedora, com ritmo mais r\u00e1pido, fluido e com poucas pausas. Evite falar devagar ou rob\u00f3tico.',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI speech failed: ${response.status} ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

module.exports = { getChatGptFallbackReply, transcribeAudioBuffer, synthesizeSpeechBuffer };
