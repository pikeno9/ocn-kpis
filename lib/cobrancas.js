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

module.exports = { fetchPagamentos };
