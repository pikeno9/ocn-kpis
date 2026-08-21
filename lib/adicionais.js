// =====================================================================
// ADICIONAIS (painel de cobranças, aba "Adicionais → Lançamentos")
//
// Descontos e custos extras lançados por CLIENTE, com motivo e a segunda-feira
// de vencimento. É a única fonte que tem a DATA do desconto de primeira
// ativação da inDrive por motorista — a planilha import_baseID só tem o valor,
// e sem data o UE joga o desconto inteiro no M0, que não é quando o dinheiro
// andou.
//
// A rota /api/v1/descontos é nova no painel; enquanto ela não estiver no ar
// esta função devolve null e o site segue com a fonte antiga (valor da
// import_baseID numa data fixa). Falha aqui NUNCA derruba o refresh.
//
// Devolve { placas: { PLACA: { desconto, descontoEm, cliente, motivo } } },
// já casado com a placa pelo vínculo do motorista na data do lançamento.
// =====================================================================
const C = require('../config/static');

// nome comparável: sem acento, sem pontuação, espaços colapsados, maiúsculo
function chaveNome(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Motorista cujo nome no painel nao casa com nenhum vinculo da base de clientes. Confirmado
// com o Enrico em 21/08/2026: e a TKU0C41 (rodada 2, R$ 250, lancamento de 27/07). Sem isto o
// lancamento dele ficaria de fora e a rodada 2 nao fecharia.
const PLACA_MANUAL = {
  'EDER GONCALVES RIBEIRO': 'TKU0C41',
};

async function fetchAdicionais(motivo) {
  if (!C.COBRANCAS_TOKEN) return null;
  const url = C.COBRANCAS_API + '/api/v1/descontos' + (motivo ? '?motivo=' + encodeURIComponent(motivo) : '');
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + C.COBRANCAS_TOKEN } });
  if (!r.ok) return null;                       // 404 = rota ainda não publicada
  const d = await r.json();
  return Array.isArray(d && d.itens) ? d.itens : null;
}

// itens da inDrive (motivo com "indrive" e "ativa"/"activa") casados com a placa
// do motorista NA DATA do lançamento. Um motorista que trocou de carro tem dois
// vínculos; o desconto pertence ao carro que ele tinha naquela semana.
function porPlaca(itens, vinculos) {
  const porNome = {};
  (vinculos || []).forEach((v) => {
    const k = chaveNome(v.nome);
    if (!k) return;
    (porNome[k] = porNome[k] || []).push(v);
  });
  const placas = {};
  let semVinculo = 0;
  for (const it of itens || []) {
    if (it.tipo !== 'desconto') continue;
    const m = String(it.motivo || '').toLowerCase();
    if (!(m.includes('indrive') && /ativa|activa/.test(m))) continue;
    const forcada = PLACA_MANUAL[chaveNome(it.cliente)];
    const cands = forcada ? [{ placa: forcada, ini: '0000-01-01', fim: null }] : (porNome[chaveNome(it.cliente)] || []);
    if (!cands.length) { semVinculo++; continue; }
    const dia = String(it.venc_monday || '').slice(0, 10);
    // vínculo vigente na data; sem data utilizável, fica o mais recente
    const alvo = cands.find((v) => v.ini <= dia && (!v.fim || v.fim >= dia))
      || cands.slice().sort((a, b) => String(b.ini).localeCompare(String(a.ini)))[0];
    if (!alvo || !alvo.placa) { semVinculo++; continue; }
    const o = placas[alvo.placa] || (placas[alvo.placa] = { desconto: 0, descontoEm: null, cliente: it.cliente, motivo: it.motivo });
    o.desconto += Number(it.valor) || 0;
    // parcelado: vale a data da PRIMEIRA parcela (é quando o benefício começou)
    if (dia && (!o.descontoEm || dia < o.descontoEm)) o.descontoEm = dia;
  }
  return { placas, semVinculo };
}

async function build(vinculos) {
  const itens = await fetchAdicionais('inDrive');
  if (!itens) return null;
  const { placas, semVinculo } = porPlaca(itens, vinculos);
  const n = Object.keys(placas).length;
  if (!n) return null;
  console.log(`[adicionais] inDrive: ${n} placas com desconto datado` + (semVinculo ? ` (${semVinculo} lançamentos sem vínculo)` : ''));
  return { placas };
}

module.exports = { build, chaveNome };
