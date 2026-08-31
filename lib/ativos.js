// =====================================================================
// CARROS ATIVOS — conceito novo (31/08/2026), definido pelo Enrico:
//
//   No mês, o carro é INATIVO se ficou com DUAS OU MAIS semanas sem
//   pagamento. Com uma ou nenhuma, é ATIVO.
//
// Semana sem pagamento é semana sem pagamento, não importa o motivo: tanto
// faz o motorista ter deixado de pagar ou o carro estar parado no pátio sem
// motorista nenhum. O que interessa é o carro não ter produzido. Por isso a
// conta não parte das semanas COBRADAS na matriz, e sim das segundas-feiras
// do calendário: para cada segunda em que o carro já estava na rua, ou entrou
// dinheiro daquele carro, ou é uma semana sem pagamento.
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
// O motivo de cada semana perdida (motorista não pagou × carro sem motorista)
// não muda o veredito, mas viaja junto para o detalhe do mês: são duas doenças
// diferentes e a operação trata cada uma de um jeito.
// =====================================================================
const C = require('../config/static');

const DIA = 86400000;
const ISO = (d) => new Date(d).toISOString().slice(0, 10);

// segunda-feira da semana que contém a data (string ISO ou Date)
function segunda(d) {
  const x = (d instanceof Date) ? new Date(d.getTime()) : new Date(String(d) + 'T12:00:00');
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return ISO(x);
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

const PAGA = { pago: 1, pago_atrasado: 1, retirada: 1, abonado: 1 };

function build(matrizData, adiamentos, starts, losses, refDate) {
  if (!matrizData || !Array.isArray(matrizData.placas)) return null;
  const hoje = refDate || new Date();
  const semAtual = segunda(hoje);      // esta semana e as futuras ficam de fora
  const LIMITE = 2;                    // semanas sem pagamento que tornam o carro inativo

  // ---- o que a matriz sabe de cada placa: semana -> pagou? ----
  const pagoPor = {};                  // "placa|segunda" -> pagou
  const cobrado = {};                  // "placa|segunda" -> tinha motorista (houve lançamento)
  for (const pl of matrizData.placas) {
    for (const v of (pl.vinculos || [])) {
      const ps = ((v.valores || {}).por_semana || []).slice()
        .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
      const fee = (ps.find((s) => s.esperado > 0) || {}).esperado || 0;
      // créditos de adiamento deste cliente, gastos nas primeiras semanas em aberto
      let credito = (adiamentos && adiamentos[v.cliente] && fee) ? Math.round(adiamentos[v.cliente] / fee) : 0;
      for (const s of ps) {
        const w = segunda(String(s.vencimento || '').slice(0, 10));
        if (!w) continue;
        let ok = !!PAGA[s.status];
        if (!ok && s.status === 'em_aberto' && credito > 0) { credito--; ok = true; }
        cobrado[pl.placa + '|' + w] = true;
        if (ok) pagoPor[pl.placa + '|' + w] = true;
      }
    }
  }

  // ---- meses cobertos: da 1ª entrega até o mês corrente ----
  const placasFrota = Object.keys(starts || {});
  if (!placasFrota.length) return null;
  const prim = placasFrota.map((p) => starts[p]).sort()[0];
  const meses = [];
  {
    const d = new Date(prim + 'T12:00:00'); d.setDate(1);
    const fimMesCorrente = ISO(hoje).slice(0, 7);
    for (let i = 0; i < 60; i++) {
      const m = ISO(d).slice(0, 7);
      meses.push(m);
      if (m >= fimMesCorrente) break;
      d.setMonth(d.getMonth() + 1);
    }
  }

  // segundas FECHADAS de um mês
  const segundasDoMes = (m) => {
    const [y, mm] = m.split('-').map(Number);
    const out = [];
    const d = new Date(y, mm - 1, 1, 12);
    while (d.getMonth() === mm - 1) {
      if (d.getDay() === 1) { const w = ISO(d); if (w < semAtual) out.push(w); }
      d.setDate(d.getDate() + 1);
    }
    return out;
  };

  const out = meses.map((m) => {
    const semanas = segundasDoMes(m);
    const fim = ISO(new Date(Number(m.split('-')[0]), Number(m.split('-')[1]), 0, 12));
    const frota = placasFrota.filter((p) => starts[p] <= fim && !(losses && losses[p] && losses[p] <= fim));
    const ativos = [], inativos = [];
    frota.forEach((p) => {
      const desde = segunda(starts[p]);                         // semana da entrega já conta
      const perdeu = losses && losses[p] ? segunda(losses[p]) : null;
      let semPag = 0, semMotorista = 0, naRua = 0;
      semanas.forEach((w) => {
        if (w < desde) return;                                   // carro ainda não existia na frota
        if (perdeu && w > perdeu) return;                        // perda total: deixou de ser frota
        naRua++;
        if (pagoPor[p + '|' + w]) return;
        semPag++;
        // sem NENHUM lançamento da placa naquela semana = carro sem motorista
        if (!cobrado[p + '|' + w]) semMotorista++;
      });
      if (!naRua) return;                                        // mês inteiro fora da frota
      if (semPag >= LIMITE) inativos.push({ placa: p, semanas: semPag, semMotorista });
      else ativos.push(p);
    });
    const nInat = inativos.length, nAtiv = ativos.length, tot = nAtiv + nInat;
    return {
      mes: m,
      frota: tot,
      ativos: nAtiv,
      inativos: nInat,
      pctAtivo: tot ? (nAtiv / tot) * 100 : null,
      semanas: semanas.length,
      placasInativas: inativos.sort((a, b) => b.semanas - a.semanas),
    };
  }).filter((x) => x.frota > 0);

  return { limite: LIMITE, semanaCorrente: semAtual, meses: out };
}

async function buildAll(matrizData, starts, losses, refDate) {
  const adiamentos = await fetchAdiamentos();
  return build(matrizData, adiamentos, starts, losses, refDate);
}

module.exports = { build, buildAll, fetchAdiamentos };
