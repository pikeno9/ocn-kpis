// =====================================================================
// MULTAS — puxa as infrações do site ocn-painel-cobrancas e devolve
// { placas: { PLACA: [{ d, v, j }] } } com as multas JÁ PAGAS:
//   d = data do pagamento (YYYY-MM-DD, de pagamento.pago_em)
//   v = valor cobrado do cliente (valores.total_a_cobrar)
//   j = juros/prêmio recebido pela OCN (pagamento.juros_recebido)
//
// ATENÇÃO — NÃO usar `pagamento.mp_valor_total` para somar: quando o
// cliente paga várias multas num PIX em lote (mp_compartilhado = true),
// o MESMO total aparece repetido em cada infração. Numa placa real isso
// dava 19.024,94 em vez dos 1.729,54 corretos (11× a mais). O campo
// `valores.total_a_cobrar` é por infração e fecha com o resumo da API.
// =====================================================================
const C = require('../config/static');

async function fetchMultas() {
  if (!C.COBRANCAS_TOKEN) throw new Error('COBRANCAS_TOKEN não definido');
  const r = await fetch(C.COBRANCAS_API + '/api/v1/multas', {
    headers: { Authorization: 'Bearer ' + C.COBRANCAS_TOKEN },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const placas = {};
  for (const p of (d && d.placas) || []) {
    const pagas = [];
    for (const i of p.infracoes || []) {
      const pg = i.pagamento || {};
      if (!pg.pago || !pg.pago_em) continue;           // só multa efetivamente paga, com data
      const v = Number((i.valores || {}).total_a_cobrar) || 0;
      if (!v) continue;
      pagas.push({ d: String(pg.pago_em).slice(0, 10), v, j: Number(pg.juros_recebido) || 0 });
    }
    if (pagas.length) placas[p.placa] = pagas;
  }
  return { placas };
}

module.exports = { fetchMultas };
