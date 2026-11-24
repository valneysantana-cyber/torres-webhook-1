'use strict';

/**
 * nameLink.js — acha a reserva pelo NOME quando o telefone do WhatsApp não está em nenhuma reserva.
 *
 * 24/11/2026 (Valney): Booking/Airbnb mandam telefone mascarado ou vazio e o hóspede escreve de outro
 * número — o robô não achava a reserva e respondia como se fosse prospect ("sem reserva").
 *
 * Regra (conservadora de propósito — vínculo errado expõe reserva de outra pessoa):
 *  - só reservas do tenant do número, não canceladas, hospedado hoje ou chegando em até 3 dias;
 *  - nome usado: o do perfil do WhatsApp OU a mensagem, quando ela é só um nome ("Maria Souza",
 *    "meu nome é Maria Souza");
 *  - casa só se 1º nome + pelo menos mais um nome forem iguais (sem acento/maiúscula) e se houver
 *    UMA única pessoa com esse nome na janela; só o 1º nome nunca vincula;
 *  - só reserva SEM telefone e sem vínculo; reserva com celular fica para o vínculo manual na tela.
 * Vinculando, grava na reserva (Atlas) waLinkedPhone + guestPhoneClean = número do WhatsApp.
 * O stays_sync do VPS preserva esse vínculo e a tela
 * de Mensagens do CRM mostra/desfaz (POST/DELETE /admin/conversas/vincular).
 */

const STOP = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter((t) => t.length >= 2 && !STOP.has(t));

function phoneVariants(p) {
  const d = String(p || '').replace(/\D/g, '');
  const v = d ? [d] : [];
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') v.push(d.slice(0, 4) + d.slice(5));
  else if (d.length === 12 && d.startsWith('55')) v.push(d.slice(0, 4) + '9' + d.slice(4));
  return v;
}

// Mensagem que é SÓ um nome (2 a 6 palavras de letras), com ou sem "meu nome é / sou o(a)".
function nameFromMessage(body) {
  let t = String(body || '').trim();
  if (!t || t.length > 70 || /\d|@|\?/.test(t)) return null;
  t = t.replace(/^(oi|ola|olá|bom dia|boa tarde|boa noite)[,!. ]+/i, '')
       .replace(/^(meu nome (e|é)|me chamo|aqui (e|é)( o| a)?|sou (o|a)?)\s+/i, '')
       .replace(/[.!,;]+$/, '').trim();
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 6) return null;
  if (!words.every((w) => /^[A-Za-zÀ-ÿ'-]+$/.test(w))) return null;
  return t;
}

// "estou no 508", "flat 1204", "apto 1402", "quarto 404", "hospedada no 1204" → número do flat (3 ou 4 dígitos).
// Exige uma palavra de contexto antes do número para não confundir com horário, valor ou código.
function flatFromMessage(body) {
  const t = String(body || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = /\b(?:flat|apto?|ap\.|apartamento|quarto|unidade|suite|(?:estou|to|tou|estamos|hospedad[oa]s?|fiquei|ficando)\s+n[oa])\s*(?:n[ºo°.]?\s*)?(\d{3,4})\b/.exec(t);
  return m ? m[1] : null;
}

function brtDate(offsetDays) {
  const d = new Date(Date.now() - 3 * 3600000 + (offsetDays || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Casa um nome com a lista de reservas. Devolve a reserva só quando o casamento é forte e único. */
function matchStrong(name, reservations) {
  const tk = tokens(name);
  if (tk.length < 2) return null;
  const hits = [];
  for (const r of reservations) {
    const rt = tokens(r.guestName);
    if (!rt.length || rt[0] !== tk[0]) continue;
    const score = tk.filter((t) => rt.includes(t)).length;
    if (score >= 2) hits.push({ r, score });
  }
  if (!hits.length) return null;
  const top = Math.max(...hits.map((h) => h.score));
  const best = hits.filter((h) => h.score === top);
  const pessoas = new Set(best.map((h) => norm(h.r.guestName)));
  if (pessoas.size !== 1) return null; // duas pessoas diferentes com o mesmo nome → não chuta
  // mesma pessoa com mais de uma reserva na janela: a que está hospedada / chega primeiro
  return best.map((h) => h.r).sort((a, b) => String(a.checkInDate).localeCompare(String(b.checkInDate)))[0];
}

/**
 * Tenta vincular o número à reserva pelo nome. Nunca lança erro (falha = segue o fluxo normal).
 * @returns {Promise<null|{reservation:object, via:string, name:string}|{ask:true, flat:string}>}
 *   ask=true: citou um flat com reserva sem telefone, mas o perfil não confirma → perguntar o nome do titular.
 */
async function tryLinkByName({ Reservation, from, tenantId, contactName, body }) {
  try {
    if (!Reservation || !Reservation.collection || !from) return null;
    const col = Reservation.collection; // driver nativo: o schema mongoose não conhece waLinkedPhone
    const phones = phoneVariants(from);
    if (!phones.length) return null;
    const hoje = brtDate(0);
    const jaTem = await col.findOne({ $or: [{ guestPhoneClean: { $in: phones } }, { guestPhone: { $in: phones } }, { waLinkedPhone: { $in: phones } }],
      checkOutDate: { $gte: hoje }, type: { $not: /^cancel/i } }, { projection: { _id: 1 } });
    if (jaTem) return null;

    const nomes = [];
    const doTexto = nameFromMessage(body);
    if (doTexto) nomes.push({ name: doTexto, via: 'mensagem' });
    if (contactName) nomes.push({ name: contactName, via: 'perfil' });
    const flatCitado = flatFromMessage(body);
    if (!nomes.length && !flatCitado) return null;

    const janela = await col.find({
      tenantId: tenantId || 'torres',
      type: { $not: /^cancel/i },
      status: { $nin: ['cancelado', 'no-show'] },
      checkInDate: { $lte: brtDate(3) },
      checkOutDate: { $gte: hoje },
    }, { projection: { guestName: 1, confirmationCode: 1, staysId: 1, listingName: 1, checkInDate: 1, checkOutDate: 1,
      guestPhoneClean: 1, waLinkedPhone: 1, tenantId: 1 } }).limit(300).toArray();
    // Só reserva SEM telefone (Booking não manda desde 29/09) e sem vínculo com outro número. Reserva que já tem
    // celular fica para o vínculo manual na tela de Mensagens: trocar o guestPhoneClean dela faria o robô deixar de
    // reconhecer o número verdadeiro — e um homônimo/impostor poderia "assumir" a reserva só dizendo o nome.
    const livres = janela.filter((r) => !r.waLinkedPhone && !String(r.guestPhoneClean || '').replace(/\D/g, ''));

    for (const n of nomes) {
      const r = matchStrong(n.name, janela); // unicidade avaliada em TODA a janela (homônimo com telefone também conta)
      if (!r || !livres.includes(r)) continue;
      const set = { waLinkedPhone: phones[0], guestPhoneClean: phones[0], waLinkedAt: new Date(), waLinkedBy: 'robo-nome-' + n.via };
      // filtro repetido no update: se outra mensagem vinculou no meio do caminho, não sobrescreve
      const up = await col.updateOne({ _id: r._id, waLinkedPhone: { $exists: false } }, { $set: set });
      if (up && up.matchedCount === 0) continue;
      console.log('[name-link] ' + from + ' → ' + r.confirmationCode + ' (' + r.guestName + ' · ' + r.listingName + ') via ' + n.via + ' "' + n.name + '"');
      return { reservation: Object.assign({}, r, set), via: n.via, name: n.name };
    }

    // 24/11/2026: hóspede diz o flat ("estou no 508", "flat 1204"). Vincula só se: a reserva é daquele flat e está
    // hospedada hoje ou chega amanhã; o 1º nome do PERFIL é compatível com o 1º nome do titular (prefixo: "Ca"→Carolina,
    // "Rafa"→Rafael; "Rafa"≠Breno); e há UMA só reserva compatível. Sem nome de perfil compatível não vincula —
    // dizer o número do flat sozinho não pode dar acesso aos dados da reserva de outra pessoa.
    if (flatCitado) {
      const p = tokens(contactName)[0];
      const noFlat = janela.filter((r) => String(r.listingName || '').replace(/\D/g, '') === flatCitado
        && r.checkInDate <= brtDate(1));
      const compat = noFlat.filter((r) => { const g = tokens(r.guestName)[0] || ''; return p && g && (g.startsWith(p) || p.startsWith(g)); });
      if (compat.length === 1 && livres.includes(compat[0])) {
        const r = compat[0];
        const set = { waLinkedPhone: phones[0], guestPhoneClean: phones[0], waLinkedAt: new Date(), waLinkedBy: 'robo-flat' };
        const up = await col.updateOne({ _id: r._id, waLinkedPhone: { $exists: false } }, { $set: set });
        if (!(up && up.matchedCount === 0)) {
          console.log('[name-link] ' + from + ' → ' + r.confirmationCode + ' (' + r.guestName + ' · ' + r.listingName + ') via flat ' + flatCitado + ' + perfil "' + contactName + '"');
          return { reservation: Object.assign({}, r, set), via: 'flat', name: contactName };
        }
      } else if (noFlat.length) {
        console.log('[name-link] ' + from + ' citou o flat ' + flatCitado + ' mas sem vínculo seguro (perfil "' + contactName + '", ' + noFlat.length + ' reserva(s) no flat, ' + compat.length + ' compatível(is))');
        // há reserva sem telefone naquele flat → vale perguntar o nome do titular antes (Valney 24/11)
        if (noFlat.some((r) => livres.includes(r))) return { ask: true, flat: flatCitado };
      }
    }
    return null;
  } catch (e) {
    console.warn('[name-link] falhou (segue fluxo normal):', e.message);
    return null;
  }
}

module.exports = { tryLinkByName, matchStrong, nameFromMessage, flatFromMessage, tokens };
