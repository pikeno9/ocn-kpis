// =====================================================================
// MULTAS (lado da RECEITA) — o que a OCN cobra do cliente pelas infrações.
// Devolve { placas: { PLACA: [{ d, v, j, pago }] }, prazoRecebimentoDias, taxaRecebimento }
//   d    = data do pagamento (pago) OU data da infração (ainda em aberto)
//   v    = valor cobrado do cliente (valores.total_a_cobrar)
//   j    = juros/prêmio recebido pela OCN
//   pago = true se o cliente já pagou
//
// ATENÇÃO — NÃO usar `pagamento.mp_valor_total` para somar: quando o cliente paga
// várias multas num PIX em lote (mp_compartilhado = true), o MESMO total aparece
// repetido em cada infração (numa placa real dava 19.024,94 em vez de 1.729,54).
// `valores.total_a_cobrar` é por infração e fecha com o resumo da API.
//
// A lista traz também as EM ABERTO para o UE projetar o recebível — senão a receita
// só reconheceria caixa enquanto a despesa (multas_consolidado) reconhece tudo o que
// devemos, e a linha de multas ficaria artificialmente negativa.
// =====================================================================
const C = require('../config/static');

const MATURIDADE_DIAS = 75; // coorte madura: multas antigas o bastante para já terem sido pagas

async function fetchMultas() {
  if (!C.COBRANCAS_TOKEN) throw new Error('COBRANCAS_TOKEN não definido');
  const r = await fetch(C.COBRANCAS_API + '/api/v1/multas', {
    headers: { Authorization: 'Bearer ' + C.COBRANCAS_TOKEN },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const hoje = Date.now();
  const placas = {};
  const lags = [];                       // dias entre a infração e o pagamento do cliente
  let madVal = 0, madPago = 0;           // coorte madura, em valor
  for (const p of (d && d.placas) || []) {
    const lista = [];
    for (const i of p.infracoes || []) {
      const v = Number((i.valores || {}).total_a_cobrar) || 0;
      if (!v) continue;
      const pg = i.pagamento || {};
      const inf = i.data_hora_infracao ? new Date(i.data_hora_infracao) : null;
      const pagoEm = pg.pago && pg.pago_em ? new Date(pg.pago_em) : null;
      if (inf && pagoEm) lags.push((pagoEm - inf) / 86400000);
      if (inf && (hoje - inf) / 86400000 >= MATURIDADE_DIAS) { madVal += v; if (pg.pago) madPago += v; }
      const ref = pagoEm || inf;
      if (!ref) continue;
      lista.push({ d: ref.toISOString().slice(0, 10), v, j: Number(pg.juros_recebido) || 0, pago: !!pg.pago });
    }
    if (lista.length) placas[p.placa] = lista;
  }
  const prazoRecebimentoDias = lags.length ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length) : 42;
  // % que efetivamente entra, medido só nas multas já maduras (as recentes ainda estão no prazo
  // e puxariam a taxa para baixo sem motivo). Piso/teto para não distorcer com amostra pequena.
  let taxaRecebimento = madVal > 0 ? madPago / madVal : 0.85;
  taxaRecebimento = Math.min(1, Math.max(0.3, taxaRecebimento));
  return { placas, prazoRecebimentoDias, taxaRecebimento };
}

module.exports = { fetchMultas };
