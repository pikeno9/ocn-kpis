// =====================================================================
// ITENS DE REPOSIÇÃO — ocorrências do site ocn-frota (categoria
// "itens_reposicao"): trocas de pastilhas, disco e pneus.
// Devolve { placas: { PLACA: [{ d, itens: ['pastilhas','disco',...] }] } }.
// O subtipo não é estruturado na API — vem do texto livre (`detalhe`),
// então classifica-se por palavra-chave. Eventos cancelados ficam de fora,
// assim como os sem item reconhecido (ex.: casos de adesivo).
// =====================================================================
const C = require('../config/static');

async function fetchReposicao() {
  if (!C.FROTA_TOKEN) throw new Error('FROTA_TOKEN não definido');
  const r = await fetch(C.FROTA_API + '?resource=ocorrencias', {
    headers: { Authorization: 'Bearer ' + C.FROTA_TOKEN },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const placas = {};
  for (const o of (d && d.ocorrencias) || []) {
    if (o.categoria !== 'itens_reposicao') continue;
    if (o.status === 'cancelado') continue;
    const t = String(o.detalhe || '').toLowerCase();
    const itens = [];
    if (/pastilha/.test(t)) itens.push('pastilhas');
    if (/disco/.test(t)) itens.push('disco');
    if (/pneu/.test(t)) itens.push('pneus');
    if (!itens.length || !o.plate || !o.data_evento) continue;
    (placas[o.plate] = placas[o.plate] || []).push({ d: String(o.data_evento).slice(0, 10), itens });
  }
  return { placas };
}

module.exports = { fetchReposicao };
