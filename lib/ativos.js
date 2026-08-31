// =====================================================================
// CARROS ATIVOS — conceito do Enrico, na régua de 31/08 e 05/09/2026:
//
//   INATIVO = carro que ficou DUAS SEMANAS SEGUIDAS sem pagamento.
//
//   · visão SEMANAL: na semana W o carro está inativo se não pagou em W E
//     não pagou em W−1. Pagou em W−1 e não pagou em W? Ativo. Não pagou em
//     W−1 e pagou em W? Ativo também — a dupla só fecha com as duas.
//   · visão MENSAL: inativo no mês se em ALGUMA semana do mês essa dupla
//     fechou. É a mesma régua, agregada — o mês herda o veredito da semana.
//
// Seguidas de verdade: duas semanas soltas no mês não bastam. Um carro que
// falha, paga, e falha de novo está claudicando, não parado — e a operação
// trata os dois casos de forma diferente.
//
// Semana sem pagamento é semana sem pagamento, não importa o motivo: tanto
// faz o motorista ter deixado de pagar ou o carro estar parado no pátio sem
// motorista nenhum. O que interessa é o carro não ter produzido. Por isso a
// conta parte das segundas-feiras do CALENDÁRIO, não das semanas cobradas na
// matriz: senão o carro parado sumiria da conta em vez de acumular falhas.
//
// Duas decisões que a definição não cobria:
//
// 1) SEMANA CORRENTE FORA. A semana que vence hoje ainda está sendo cobrada:
//    medida em 31/08 aparecia com 78% em aberto, contra 0–2,5% de todas as
//    semanas fechadas. Entrar com ela jogaria a frota inteira para "inativa"
//    toda segunda-feira de manhã. Só semana FECHADA conta.
//
// 2) SEMANALIDADE ADIADA conta como paga. Quem negociou o adiamento não é
//    caloteiro: o valor foi parcelado e é cobrado depois (aba Adicionais do
//    painel, motivo "Semanalidade adiada", lançado como custo extra). O nº de
//    semanas perdoadas sai de total adiado ÷ semanalidade, e os créditos vão
//    para as PRIMEIRAS semanas em aberto do cliente — que são exatamente as
//    que foram adiadas. Conferido placa a placa: Thiago 5/5, Jonathan 7/7,
//    Adriano 2 de 3 (a 3ª é calote de verdade). Acordo marcado como
//    "cancelada" no motivo não gera crédito.
//
// Semana paga com atraso conta como PAGA — o dinheiro entrou.
//
// A primeira semana do carro nunca pode ser inativa: sem W−1 não há dupla.
// =====================================================================
const C = require('../config/static');

const ISO = (d) => new Date(d).toISOString().slice(0, 10);

// segunda-feira da semana que contém a data (string ISO ou Date)
function segunda(d) {
  const x = (d instanceof Date) ? new Date(d.getTime()) : new Date(String(d) + 'T12:00:00');
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return ISO(x);
}
const maisSemanas = (w, n) => { const d = new Date(w + 'T12:00:00'); d.setDate(d.getDate() + 7 * n); return ISO(d); };

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

const PAGA = { pago: 1, pago_atrasado: 1, retirada: 1, abonado: 1 };

function build(matrizData, adiamentos, starts, losses, refDate) {
  if (!matrizData || !Array.isArray(matrizData.placas)) return null;
  const placasFrota = Object.keys(starts || {});
  if (!placasFrota.length) return null;
  const hoje = refDate || new Date();
  const semAtual = segunda(hoje);        // esta semana e as futuras ficam de fora

  // ---- matriz: quem pagou o quê, e em que semana havia motorista ----
  const pagou = {}, tinhaMotorista = {};   // "placa|segunda" -> true
  for (const pl of matrizData.placas) {
    for (const v of (pl.vinculos || [])) {
      const ps = ((v.valores || {}).por_semana || []).slice()
        .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
      const fee = (ps.find((s) => s.esperado > 0) || {}).esperado || 0;
      let credito = (adiamentos && adiamentos[v.cliente] && fee) ? Math.round(adiamentos[v.cliente] / fee) : 0;
      for (const s of ps) {
        const w = segunda(String(s.vencimento || '').slice(0, 10));
        if (!w) continue;
        let ok = !!PAGA[s.status];
        if (!ok && s.status === 'em_aberto' && credito > 0) { credito--; ok = true; }
        tinhaMotorista[pl.placa + '|' + w] = true;
        if (ok) pagou[pl.placa + '|' + w] = true;
      }
    }
  }

  // ---- grade de semanas fechadas, da 1ª entrega até a semana passada ----
  const prim = placasFrota.map((p) => starts[p]).sort()[0];
  const semanas = [];
  for (let w = segunda(prim); w < semAtual; w = maisSemanas(w, 1)) semanas.push(w);
  if (!semanas.length) return null;

  // ---- por placa: estado de cada semana em que o carro estava na frota ----
  // 0 = pagou · 1 = falhou · null = fora da frota
  const est = {};
  placasFrota.forEach((p) => {
    const desde = segunda(starts[p]);
    const perdeu = (losses && losses[p]) ? segunda(losses[p]) : null;
    const a = est[p] = new Array(semanas.length).fill(null);
    semanas.forEach((w, k) => {
      if (w < desde) return;
      if (perdeu && w > perdeu) return;
      a[k] = pagou[p + '|' + w] ? 0 : 1;
    });
  });

  // dupla fechada: falhou nesta E na anterior (a anterior tem de existir para a placa)
  const inativoNa = (p, k) => {
    const a = est[p];
    return k > 0 && a[k] === 1 && a[k - 1] === 1;
  };
  const semMotorista = (p, k) => !tinhaMotorista[p + '|' + semanas[k]];

  // ---- série SEMANAL ----
  const serieSem = semanas.map((w, k) => {
    const naRua = placasFrota.filter((p) => est[p][k] != null);
    const inat = naRua.filter((p) => inativoNa(p, k));
    return {
      semana: w,
      frota: naRua.length,
      ativos: naRua.length - inat.length,
      inativos: inat.length,
      pctAtivo: naRua.length ? ((naRua.length - inat.length) / naRua.length) * 100 : null,
      placasInativas: inat.map((p) => ({ placa: p, semMotorista: semMotorista(p, k) && semMotorista(p, k - 1) ? 2 : (semMotorista(p, k) ? 1 : 0), semanas: 2 })),
    };
  });

  // ---- série MENSAL: o mês herda o veredito das semanas dele ----
  const meses = [...new Set(semanas.map((w) => w.slice(0, 7)))];
  const serieMes = meses.map((m) => {
    const idx = semanas.map((w, k) => (w.slice(0, 7) === m ? k : -1)).filter((k) => k >= 0);
    const naRua = placasFrota.filter((p) => idx.some((k) => est[p][k] != null));
    const det = [];
    naRua.forEach((p) => {
      const ks = idx.filter((k) => inativoNa(p, k));
      if (!ks.length) return;
      // semanas perdidas no mês e quantas delas foram sem motorista nenhum
      const perdidas = idx.filter((k) => est[p][k] === 1);
      det.push({ placa: p, semanas: perdidas.length, semMotorista: perdidas.filter((k) => semMotorista(p, k)).length });
    });
    return {
      mes: m,
      frota: naRua.length,
      ativos: naRua.length - det.length,
      inativos: det.length,
      pctAtivo: naRua.length ? ((naRua.length - det.length) / naRua.length) * 100 : null,
      semanas: idx.length,
      placasInativas: det.sort((a, b) => b.semanas - a.semanas),
    };
  }).filter((x) => x.frota > 0);

  return { regra: 2, semanaCorrente: semAtual, meses: serieMes, semanasSerie: serieSem };
}

async function buildAll(matrizData, starts, losses, refDate) {
  const adiamentos = await fetchAdiamentos();
  return build(matrizData, adiamentos, starts, losses, refDate);
}

module.exports = { build, buildAll, fetchAdiamentos };
