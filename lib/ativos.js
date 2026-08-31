// =====================================================================
// CARROS ATIVOS — conceito novo (31/08/2026), definido pelo Enrico:
//
//   No mês, o carro é INATIVO se ficou com DUAS OU MAIS semanalidades não
//   pagas. Com uma ou nenhuma, é ATIVO.
//
// Três decisões que a definição não cobria e que mudam o número:
//
// 1) SEMANA CORRENTE FORA. A semana que vence hoje ainda está sendo cobrada:
//    medida em 31/08 ela aparecia com 78% em aberto, contra 0–2,5% de todas
//    as semanas fechadas. Entrar com ela derrubaria a frota inteira para
//    "inativa" toda segunda-feira. Só semana FECHADA conta.
//
// 2) CARRO SEM MOTORISTA não é ativo. Pela letra da regra ele teria zero
//    semanas não pagas e cairia como ativo — mas carro parado no pátio não
//    está produzindo. Vira um terceiro estado ("idle"), separado do
//    inadimplente, para não misturar dois problemas diferentes.
//
// 3) SEMANALIDADE ADIADA conta como paga. Quem negociou o adiamento não é
//    caloteiro: o valor foi parcelado e é cobrado depois (aba Adicionais do
//    painel, motivo "Semanalidade adiada", lançado como custo extra). O nº de
//    semanas perdoadas sai de total adiado ÷ semanalidade, e os créditos vão
//    para as PRIMEIRAS semanas em aberto do cliente — que são exatamente as
//    que foram adiadas. Conferido placa a placa: Thiago 5/5, Jonathan 7/7,
//    Adriano 2 de 3 (a 3ª é calote de verdade). Acordo marcado como
//    "cancelada" no motivo não gera crédito.
//
// Semana paga com atraso conta como PAGA — o dinheiro entrou.
// =====================================================================
const C = require('../config/static');

// segunda-feira da semana que contém a data
function segunda(d) {
  const x = new Date(d.getTime());
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

// lançamentos de adiamento por cliente: { cliente: total R$ adiado }
async function fetchAdiamentos() {
  if (!C.COBRANCAS_TOKEN) return {};
  const r = await fetch(C.COBRANCAS_API + '/api/v1/descontos?motivo=' + encodeURIComponent('Semanalidade'), {
    headers: { Authorization: 'Bearer ' + C.COBRANCAS_TOKEN },
  });
  if (!r.ok) return {};
  const d = await r.json();
  const out = {};
  (d.itens || []).forEach((x) => {
    const m = String(x.motivo || '');
    if (!/adiada/i.test(m) || /cancelada/i.test(m)) return;
    out[x.cliente] = (out[x.cliente] || 0) + (Number(x.valor) || 0);
  });
  return out;
}

// mês (YYYY-MM) -> contagem de carros por estado, no universo da FROTA daquele mês
function build(matrizData, adiamentos, starts, losses, refDate) {
  if (!matrizData || !Array.isArray(matrizData.placas)) return null;
  const hoje = refDate || new Date();
  const semAtual = segunda(hoje);      // esta semana e as futuras ficam de fora
  const LIMITE = 2;                    // semanas não pagas que tornam o carro inativo

  // por placa+mês: quantas semanas foram cobradas e quantas ficaram em aberto
  const cel = {};
  for (const pl of matrizData.placas) {
    for (const v of (pl.vinculos || [])) {
      const ps = ((v.valores || {}).por_semana || []).slice()
        .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
      const fee = (ps.find((s) => s.esperado > 0) || {}).esperado || 0;
      // créditos de adiamento deste cliente, gastos nas primeiras semanas em aberto
      let credito = (adiamentos && adiamentos[v.cliente] && fee) ? Math.round(adiamentos[v.cliente] / fee) : 0;
      for (const s of ps) {
        const venc = String(s.vencimento || '');
        if (!venc || venc >= semAtual) continue;             // semana aberta/futura
        const k = pl.placa + '|' + venc.slice(0, 7);
        const o = cel[k] || (cel[k] = { cobradas: 0, aberto: 0 });
        if (s.esperado > 0) o.cobradas++;
        if (s.status === 'em_aberto') { if (credito > 0) credito--; else o.aberto++; }
      }
    }
  }

  const meses = [...new Set(Object.keys(cel).map((k) => k.split('|')[1]))].sort();
  const fimDoMes = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm, 0, 12).toISOString().slice(0, 10); };
  const placasFrota = Object.keys(starts || {});

  const out = meses.map((m) => {
    const fim = fimDoMes(m);
    // frota do mês: carro já entregue e ainda não perdido
    const frota = placasFrota.filter((p) => starts[p] <= fim && !(losses && losses[p] && losses[p] <= fim));
    const ativos = [], inativos = [], parados = [];
    frota.forEach((p) => {
      const o = cel[p + '|' + m];
      if (!o || !o.cobradas) { parados.push(p); return; }    // sem cobrança no mês = sem motorista
      if (o.aberto >= LIMITE) inativos.push({ placa: p, semanas: o.aberto });
      else ativos.push(p);
    });
    return {
      mes: m,
      frota: frota.length,
      ativos: ativos.length,
      inativos: inativos.length,
      parados: parados.length,
      pctAtivo: frota.length ? (ativos.length / frota.length) * 100 : null,
      placasInativas: inativos.sort((a, b) => b.semanas - a.semanas),
      placasParadas: parados,
    };
  });

  return { limite: LIMITE, semanaCorrente: semAtual, meses: out };
}

async function buildAll(matrizData, starts, losses, refDate) {
  const adiamentos = await fetchAdiamentos();
  return build(matrizData, adiamentos, starts, losses, refDate);
}

module.exports = { build, buildAll, fetchAdiamentos };
