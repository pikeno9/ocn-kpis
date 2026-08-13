// =====================================================================
// COBRANÇAS — puxa a matriz de pagamentos semanais por placa do site
// ocn-painel-cobrancas e devolve { placas: { PLACA: [{v, a, r}] } }.
//   v = vencimento da semana (YYYY-MM-DD) — competência da cobrança
//   a = 1 se pago em atraso (sofre juros), 0 se em dia
//   r = valor REAL recebido em R$ (valores.por_semana; já inclui juros)
//   e = valor esperado/principal em R$ (juros da semana = r − e)
// Semana 0 (tipo "retirada") CONTA: é a primeira semanalidade, paga na
// entrega do carro (167/168 têm pago_em; a semana 1 vence ~7 dias depois).
// Semanas abonadas ficam de fora (não são receita).
// =====================================================================
const C = require('../config/static');

async function fetchPagamentos() {
  if (!C.COBRANCAS_TOKEN) throw new Error('COBRANCAS_TOKEN não definido');
  const r = await fetch(C.COBRANCAS_API + '/api/v1/matriz', {
    headers: { Authorization: 'Bearer ' + C.COBRANCAS_TOKEN },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const placas = {};
  for (const p of (d && d.placas) || []) {
    const semanas = [];
    for (const v of p.vinculos || []) {
      const valByVenc = {}; // valor real recebido por vencimento (valores.por_semana)
      for (const ps of (v.valores && v.valores.por_semana) || []) valByVenc[ps.vencimento] = ps;
      for (const s of v.semanas_pagas || []) {
        // semana 0 (tipo "retirada") = primeira semanalidade, paga na entrega do carro — conta como receita
        const pago = s.tipo === 'pago' || s.tipo === 'pago_atrasado' || (s.semana === 0 && s.tipo === 'retirada');
        if (!pago) continue; // abonado / não pago: sem receita
        const pv = valByVenc[s.vencimento];
        semanas.push({ v: s.vencimento, a: s.atrasado ? 1 : 0, r: pv && pv.recebido != null ? pv.recebido : null, e: pv && pv.esperado != null ? pv.esperado : null });
      }
    }
    if (semanas.length) placas[p.placa] = semanas;
  }
  return { placas };
}

// ---- EXTRAS: recebimentos que não são semanalidade nem multa ----
// Endpoint /api/v1/extras do painel (PR #12): custos extras da aba Adicionais +
// avulsos pagos, com cliente, valor e data. Devolve { itens: [{cliente, valor,
// pago_em, tipo}] }. Enquanto o endpoint não existir em produção (404), devolve
// null e a linha "Others" do UE simplesmente não aparece.
async function fetchExtras() {
  if (!C.COBRANCAS_TOKEN) throw new Error('COBRANCAS_TOKEN não definido');
  const r = await fetch(C.COBRANCAS_API + '/api/v1/extras', {
    headers: { Authorization: 'Bearer ' + C.COBRANCAS_TOKEN },
  });
  if (r.status === 404) return null;   // endpoint ainda não deployado — sem linha Others
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const itens = ((d && d.itens) || [])
    .filter((x) => x && Number(x.valor) > 0)
    .map((x) => ({ cliente: x.cliente || null, v: Number(x.valor), d: x.pago_em ? String(x.pago_em).slice(0, 10) : null }));
  return itens.length ? { itens } : null;
}

module.exports = { fetchPagamentos, fetchExtras };
