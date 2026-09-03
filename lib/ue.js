// =====================================================================
// UNIT ECONOMICS — lê o cashflow ORÇADO (por veículo) das abas UE - XXX
// e monta a lista de frotas (safras) a partir do import_data.
// =====================================================================
const C = require('../config/static');

const cell = (r, i) => String(r && r[i] != null ? r[i] : '').trim();

// Números em formato US/USD: vírgula = milhar, parênteses = negativo. Ex.: "(1,057)" -> -1057
function parseNum(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[(),$\s]/g, '');
  if (!s || s === '-') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : (neg ? -n : n);
}

// Linhas que encerram a parte útil da tabela (a partir daí: variações de IRR / LA version)
const STOP_PREFIX = ['Acc cashflow Month 12', 'Montlhy IRR', 'Monthly IRR', 'Anual IRR', 'Annual IRR', 'LA version'];

function parseTab(rows, periods) {
  const lines = [];
  let section = 'inflow';
  for (const r of rows) {
    const label = cell(r, 1);
    if (!label || label === 'Figures in USD' || /subrental \(12m\)/i.test(label)) continue;
    if (STOP_PREFIX.some((p) => label.startsWith(p))) break;

    // col 2 = M0 (setup inicial); cols 3..(3+periods-1) = M1..M12 → values[p] = período p (0..periods)
    const values = [];
    for (let c = 2; c <= 2 + periods; c++) values.push(parseNum(r[c]));

    let group;
    if (label === 'Total Inflow') group = 'totalInflow';
    else if (label === 'Total Outflow') group = 'totalOutflow';
    else if (label === 'Net monthly cashflow') group = 'net';
    else if (label === 'Acc Cashflow') group = 'acc';
    else group = section;

    const isTotal = group !== 'inflow' && group !== 'outflow';
    const hasVal = values.some((v) => v !== null && v !== 0);
    if (isTotal || hasVal) lines.push({ label, group, values }); // ignora linhas sem valor em nenhum período

    if (label === 'Total Inflow') section = 'outflow';
  }
  return lines;
}

// Frotas = coluna "O" (índice 14) do import_data. Cada frota é de um único modelo.
// data de recebimento (col D import_data): formatos mistos D/M e M/D
// Datas do import_clientes vêm em formato MISTO: as digitadas com zero à esquerda ("03/07") são
// D/M; as auto-formatadas pelo Google Sheets ("7/2") vêm SEM zero e são M/D. Sem o teste do zero
// à esquerda, "04/14/2026" (M/D) virava dia 4 do mês 14 = fev/2027 — data no futuro, e a linha era
// descartada silenciosamente (a taxa de recuperação media saía ~metade da real).
// Mesma regra do lib/payments.js — as duas precisam concordar.
function parseData(s) {
  const p = String(s || '').trim().split('/');
  if (p.length !== 3) return null;
  const a = +p[0], b = +p[1], y = +p[2];
  if (!a || !b || !y) return null;
  let d, m;
  if (a > 12) { d = a; m = b; }                                      // 1º campo > 12 → D/M
  else if (b > 12) { m = a; d = b; }                                 // 2º campo > 12 → M/D
  else if (p[0].length === 1 || p[1].length === 1) { m = a; d = b; } // sem zero à esquerda → M/D do Sheets
  else { d = a; m = b; }                                             // com zero à esquerda → D/M digitado
  return new Date(y, m - 1, d);
}

function buildFleets(importRows) {
  const map = {};
  for (let i = 9; i < importRows.length; i++) {
    const modelo = C.mapModelo(cell(importRows[i], 5));
    if (!modelo) continue;
    const fleet = cell(importRows[i], C.UE_FLEET_COL);
    if (!fleet) continue;
    if (!map[fleet]) map[fleet] = { fleet, model: modelo, cars: 0, inicio: null, placas: [] };
    map[fleet].cars++;
    const d = parseData(cell(importRows[i], 3)); // col D = data de recebimento
    if (d && (!map[fleet].inicio || d < map[fleet].inicio)) map[fleet].inicio = d;
    const placa = cell(importRows[i], 2); // col C = Placa
    if (placa) map[fleet].placas.push(placa);
  }
  const arr = Object.values(map).sort((a, b) => (parseInt(a.fleet, 10) || 0) - (parseInt(b.fleet, 10) || 0));
  return arr.map((f) => ({
    id: f.fleet,
    n: parseInt(f.fleet, 10) || 0,
    label: 'Fleet ' + f.fleet,
    fleet: f.fleet,
    model: f.model,
    modelLabel: (C.modelos[f.model] || {}).label || f.model,
    cars: f.cars,
    inicio: f.inicio ? f.inicio.toISOString().slice(0, 10) : null, // data mais antiga da frota
    placas: f.placas.sort(),
  }));
}

// Perdas totais por placa (import_clientes): motivo fim de vínculo = "Sinistro - PT" → { PLACA: data fim }.
// A partir dessa data a placa deixa de pagar Subrental e GPS recorrente no UE.
// ATENÇÃO: a planilha ganhou a coluna "Link Admin" (G) e TUDO andou uma casa — os índices
// antigos (placa 6, fim 10, motivo 12) passaram a ler link/início/status e a perda total
// deixou de ser detectada silenciosamente. Layout atual: H=7 placa, L=11 fim, N=13 motivo.
function buildLosses(clientesRows) {
  const out = {};
  for (const r of clientesRows || []) {
    const motivo = cell(r, 13).toLowerCase(); // col N = Motivo Fim Vínculo ("Sinitro - PT" — typo real da planilha)
    if (!/sinistro|sinitro|perda total/.test(motivo)) continue;
    const placa = cell(r, 7).toUpperCase();   // col H = Placa
    const d = parseData(cell(r, 11));         // col L = Data Fim Vínculo
    if (placa && d) out[placa] = d.toISOString().slice(0, 10);
  }
  return out;
}

// Versão do contrato do motorista ATUAL de cada placa (col O). Vínculo ativo = sem data de fim.
// Define a taxa de juros de atraso e o prêmio cobrado sobre as multas: v1/v2 = 5% e 10%;
// v3+ = 20% e 20%.
function buildContratos(clientesRows) {
  const out = {};
  for (const r of clientesRows || []) {
    const placa = cell(r, 7).toUpperCase();
    // encerrado = tem data de fim OU está marcado como inativo. Sem o teste do status, uma
    // linha antiga (que vem sem nenhuma data) passava por ativa e podia sobrescrever a versão.
    if (!placa || cell(r, 11) || cell(r, 12).toLowerCase() === 'inativo') continue;
    const v = parseInt(cell(r, 14), 10);      // col O = Versão Contrato
    if (v) out[placa] = v;
  }
  return out;
}

// Data de ENTREGA de cada placa (1º vínculo do import_clientes, col K = Data Início Vínculo).
// O eixo do UE é ancorado no início da FROTA (a entrega mais antiga), mas cada carro tem o seu
// próprio contrato de 52 semanas. Quem recebeu o carro no meio do M1 paga até o meio do M13 —
// sem isso o M1 fica artificialmente cheio e a cauda do fim do contrato some.
function buildStarts(vinculos) {
  const out = {};
  for (const v of vinculos || []) {
    if (!out[v.placa] || v.ini < out[v.placa]) out[v.placa] = v.ini; // 1º vínculo = entrega do carro
  }
  return out;
}

// Inadimplência medida no histórico: contrato encerrado por "Recuperação" = o cliente parou de
// pagar e o carro foi retomado.
//
// A taxa é POR PAGAMENTO, não por mês. O slider do UE multiplica a SEMANALIDADE
// (semanalidade × (1 − inad%)), então o denominador tem de ser o número de cobranças semanais
// esperadas — 1 por semana de vínculo. Medir por contrato-mês e aplicar por semana descontava
// 4,33x a mais do que deveria (4,84% a.m. lidos como se fossem 4,84% por pagamento).
//
// Também sai por FROTA: as coortes têm históricos bem diferentes (F2 2,3% x F4 0,7%), então a
// sugestão do slider acompanha a frota que está na tela.
// OBS: o import_clientes NÃO diz o motivo por trás da recuperação — "Recuperação" é um valor
// único na coluna N, sem submotivo. Todas entram como inadimplência; a lista de placas volta
// no payload para o cliente cruzar com a matriz de pagamentos e mostrar a evidência.
function buildChurn(vinculos, fleets, refDate) {
  const hoje = refDate || new Date();
  const fleetOf = {};
  (fleets || []).forEach((f) => (f.placas || []).forEach((p) => { fleetOf[p] = f.id; }));
  const mk = () => ({ dias: 0, recuperacoes: 0, encerrados: 0, ativos: 0, placas: [] });
  const tot = mk(), byFleet = {};
  // roda sobre a lista JÁ normalizada (datas recuperadas do ID, fim encadeado) — lendo as
  // colunas cruas, os 46 vínculos encerrados sem data ficavam de fora da conta inteira
  for (const v of vinculos || []) {
    const ini = new Date(v.ini + 'T12:00:00');
    if (isNaN(ini) || ini > hoje) continue;
    const placa = v.placa;
    const fid = fleetOf[placa];
    const inativo = !!v.inativo;
    const fim = v.fim ? new Date(v.fim + 'T12:00:00') : null;
    const ate = (fim && !isNaN(fim) && fim > ini && fim < hoje) ? fim : hoje;
    const dias = (ate - ini) / 86400000;
    const rec = inativo && /recupera/i.test(v.motivo || '');
    const bump = (o) => {
      o.dias += dias;
      if (inativo) o.encerrados++; else o.ativos++;
      if (rec) { o.recuperacoes++; if (placa) o.placas.push(placa); }
    };
    bump(tot);
    if (fid) bump(byFleet[fid] = byFleet[fid] || mk());
  }
  const close = (o) => {
    const pagamentos = o.dias / 7;            // 1 cobrança por semana de vínculo
    if (pagamentos < 4) return null;          // amostra pequena demais para sugerir qualquer coisa
    const taxa = o.recuperacoes / pagamentos;
    return {
      recuperacoes: o.recuperacoes, encerrados: o.encerrados, ativos: o.ativos,
      pagamentos: Math.round(pagamentos),
      taxa: Math.round(taxa * 100000) / 100000,   // fração POR PAGAMENTO (0,0112 = 1,12%)
      placas: o.placas,
    };
  };
  const out = close(tot);
  if (!out) return null;
  out.byFleet = {};
  Object.entries(byFleet).forEach(([k, v]) => { const c = close(v); if (c) out.byFleet[k] = c; });
  return out;
}

// Vínculos crus do import_clientes, um por linha: quem, qual placa, quando começou/terminou e
// por quê. Alimenta os gráficos por CLIENTE do site (ex.: multas somadas por cliente) — os
// agregados (churn, contratos, starts) não carregam a identidade de cada vínculo.
// A planilha só preenche as datas do vínculo ATIVO: os encerrados chegam com "Data Início
// Vínculo" e "Data Fim Vínculo" em branco. O ID da linha, porém, é sempre "<PLACA>_<AAAAMMDD>",
// e esse sufixo É a data de início — conferido nas 214 linhas de 03/09/2026: das 167 que têm
// data, o sufixo bate em 167/167 (zero divergências), e as 46 sem data têm todas o sufixo.
//
// Sem esta leitura, um carro que trocou de motorista aparecia com UM único vínculo (o atual):
// a barra de progresso do UE mostrava só o último motorista, e — pior — buildStarts datava a
// ENTREGA do carro no último vínculo. O orçado do Unit despencava justamente nesses carros,
// porque as segundas-feiras do plano só começavam a contar meses depois da entrega real.
function iniVinculo(r) {
  const d = parseData(cell(r, 10));
  if (d && !isNaN(d) && d.getFullYear() >= 2020) return d.toISOString().slice(0, 10);
  const m = String(cell(r, 0)).match(/_(\d{4})(\d{2})(\d{2})$/);
  if (!m || Number(m[1]) < 2020) return null;
  return m[1] + '-' + m[2] + '-' + m[3];
}

function buildVinculos(clientesRows) {
  const out = [];
  for (const r of clientesRows || []) {
    const placa = cell(r, 7).toUpperCase();
    if (!placa || !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) continue;
    const ini = iniVinculo(r);
    if (!ini) continue;                                             // linhas com data lixo (31/12/1899)
    const fim = parseData(cell(r, 11));
    out.push({
      nome: cell(r, 1) || null,
      placa,
      ini,
      fim: fim && !isNaN(fim) && fim.getFullYear() >= 2020 ? fim.toISOString().slice(0, 10) : null,
      inativo: cell(r, 12).toLowerCase() === 'inativo',   // col M = Status Vínculo
      motivo: cell(r, 13) || null,
      versao: parseInt(cell(r, 14), 10) || null,   // col O = Versão Contrato (muda o prêmio de multa)
    });
  }
  // vínculo encerrado sem data de fim fecha no INÍCIO DO PRÓXIMO da mesma placa: foi ali que o
  // carro trocou de mão. O último da fila fica em aberto quando o motorista ainda está com ele.
  const porPlaca = {};
  out.forEach((v) => (porPlaca[v.placa] = porPlaca[v.placa] || []).push(v));
  Object.values(porPlaca).forEach((arr) => {
    arr.sort((a, b) => (a.ini < b.ini ? -1 : 1));
    for (let i = 0; i < arr.length - 1; i++) if (!arr[i].fim) arr[i].fim = arr[i + 1].ini;
  });
  return out.length ? out : null;
}

function build(ueSheets, importRows, clientesRows, refDate) {
  const periods = C.UE_PERIODS || 12;
  const orcado = {};
  for (const [model, rows] of Object.entries(ueSheets)) {
    if (rows) orcado[model] = { periods, lines: parseTab(rows, periods) };
  }
  const hoje = (refDate || new Date());
  const fleets = buildFleets(importRows || []);
  // fonte única: starts e churn passam a ler os vínculos já normalizados
  const vinculos = buildVinculos(clientesRows || []) || [];
  return {
    periods,
    fleets,
    losses: buildLosses(clientesRows || []),
    contratos: buildContratos(clientesRows || []),
    starts: buildStarts(vinculos),
    churn: buildChurn(vinculos, fleets, hoje),
    vinculos: vinculos.length ? vinculos : null,
    orcado,
    // data de referência em BRASÍLIA: toISOString (UTC) virava o dia às 21:00 locais
    hoje: hoje.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
  };
}

module.exports = { build, parseNum, parseTab, buildFleets };
