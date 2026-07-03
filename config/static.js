// =====================================================================
// CONFIG ESTÁTICA — o que NÃO vem da planilha
// Calendário/esperado de recebimento, regras de exceção, cores, rótulos.
// (O calendário será movido para uma aba da planilha no futuro.)
// =====================================================================

const SHEET_ID = '1_LSPBd4tapoBPwzaf9yfXSnCwxC-ImehKS2ZVcJZCj0';

// Abas lidas da planilha
const TABS = {
  importData: 'import_data',
  ocorrencias: 'Ocorrencias',
  clientes: 'import_clientes',
  rh: 'import_RH',
  leads: 'import_Leads',
  time: 'import_Time',
  funil: 'funil',
  leadsInDrive: 'Leads inDrive',
  perfInDrive: 'Performance inDrive',
};

// gviz tipa a coluna e descarta células cujo conteúdo não bate com o tipo inferido
// (ex.: datas digitadas como TEXTO na coluna "Data do Evento" de Ocorrencias somem).
// Para essas abas usamos o endpoint /export (valor exibido, sem inferência de tipo),
// que exige o gid da aba em vez do nome.
const TAB_GIDS = {
  ocorrencias: '1260965965',
};

// API do painel de cobranças (matriz de pagamentos semanais por placa). Token só via env (repo público).
const COBRANCAS_API = process.env.COBRANCAS_API || 'https://ocn-painel-cobrancas.vercel.app';
const COBRANCAS_TOKEN = process.env.COBRANCAS_TOKEN || '';

// API do site de frota (odômetro + última revisão concluída por placa). Token só via env (repo público).
const FROTA_API = process.env.FROTA_API || 'https://ocn-frota.vercel.app/api/external';
const FROTA_TOKEN = process.env.FROTA_TOKEN || '';
// API do site de revisões (preços de revisão por modelo, em R$)
const REVISOES_API = process.env.REVISOES_API || 'https://frota-revisoes-production.up.railway.app';
const REVISAO_KM = 10000; // revisão a cada 10.000 km

// Unit Economics — abas de cashflow orçado (por veículo), uma por modelo
const UE_TABS = { Polo: 'UE - Polo', Argo: 'UE - Argo', Tera: 'UE - Tera' };
const UE_PERIODS = 12; // M1-M12; M0 = setup inicial (coluna 2 das abas UE)
const UE_FLEET_COL = 14; // coluna "O" (frota) em import_data = identifica a frota (1..n)

// Identidade dos modelos (color-code) — VW (Polo/Tera) em tons de azul; Fiat (Argo) em laranja vivo
const modelos = {
  Polo: { label: 'Polo Track', cor: '#1D4ED8', foto: 'cars/polo.png' }, // VW — azul forte
  Argo: { label: 'Argo Drive', cor: '#EA580C', foto: 'cars/argo.webp' }, // Fiat — laranja
  Tera: { label: 'Tera', cor: '#60A5FA', foto: 'cars/tera.png' },        // VW — azul claro
};
const corEsperado = '#282728';

// Mapeia o texto do modelo (col F import_data) para a chave Polo/Argo/Tera
function mapModelo(s) {
  s = (s || '').toLowerCase();
  if (s.includes('polo')) return 'Polo';
  if (s.includes('argo')) return 'Argo';
  if (s.includes('tera')) return 'Tera';
  return null;
}

// ---- Regras de exceção (recebimento) ----
// Datas que "transbordam" para outro dia (carro recebido no fim do mês contado no mês seguinte)
const spilloverDates = { '31/05/2026': '01/06/2026' };
// Linhas com modelo mas SEM data na coluna D são alocadas a esta data (lote 19/06)
const undatedReceivedDate = '19/06/2026';

// ---- Calendário / esperado (ESTÁTICO) ----
const mLabels = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mFull = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const esperado = {
  total: [50, 56, 64, 74, 84, 94, 106, 121, 126],
  modelo: [
    { Polo: 50 },
    { Argo: 30, Polo: 26 },
    { Polo: 64 },
    { Polo: 74 },
    { Polo: 57, Tera: 27 },
    { Polo: 47, Tera: 47 },
    { Polo: 30, Tera: 76 },
    { Tera: 121 },
    { Tera: 126 },
  ],
  interativo: [false, true, true, true, true, true, true, true, true],
  anoTotal: 775,
  acumulado: [50, 106, 170, 244, 328, 422, 528, 649, 775],
};

const semanaLabels = [['Week 1', '1–7'], ['Week 2', '8–14'], ['Week 3', '15–21'], ['Week 4', '22–28'], ['Week 5', '29–31']];
const esperadoSemanal = {
  total: {
    1: [null, 56, null, null, null],
    2: [32, 32, null, null, null],
    3: [25, 25, 24, null, null],
    4: [28, 28, 28, null, null],
    5: [34, 30, 30, null, null],
    6: [36, 36, 34, null, null],
    7: [50, 50, 21, null, null],
    8: [126, null, null, null, null],
  },
  modelo: {
    1: [null, { Argo: 30, Polo: 26 }, null, null, null],
    2: [{ Polo: 32 }, { Polo: 32 }, null, null, null],
    3: [{ Polo: 25 }, { Polo: 25 }, { Polo: 24 }, null, null],
    4: [{ Polo: 19, Tera: 9 }, { Polo: 19, Tera: 9 }, { Polo: 19, Tera: 9 }, null, null],
    5: [{ Polo: 17, Tera: 17 }, { Polo: 15, Tera: 15 }, { Polo: 15, Tera: 15 }, null, null],
    6: [{ Polo: 10, Tera: 26 }, { Polo: 10, Tera: 26 }, { Polo: 10, Tera: 24 }, null, null],
    7: [{ Tera: 50 }, { Tera: 50 }, { Tera: 21 }, null, null],
    8: [{ Tera: 126 }, null, null, null, null],
  },
  notas: {
    1: 'May: 06/05 (30 Argo) and 13–14/05 (26 Polo). Expected: 08/05 (30 Argo) + 13/05 (26 Polo).',
    2: 'June: 38 Argo early (33 from 31/05 + 5 from 03/06) and 19/06 (18 Tera + 1 Argo). Expected: 64 Polo. The Teras arrived ~2 months ahead of the calendar (1st planned for Aug).',
    7: 'November: expected capped at 121 (50+50+21 Tera).',
    8: 'December: 126 Tera at the start of the month.',
  },
};

const proximoLote = { mesIndex: 3, semanaIndex: 0, modelo: 'Polo', qtd: 25, dataLabel: '02/07', desc: '25 Polo' };

const notaMensal =
  'Exceptions: 33 Argo from 05/31 counted in June · 18 Tera + 1 Argo from 06/19 (rows with no date in the base) included in June · Nov capped at 121 (overflow from the 11/19 batch → Dec = 126) · April has no expected value in the calendar.';

// ---- Status da frota (coluna Q). match = textos da planilha que caem nesse status ----
const statusItems = [
  { label: 'Rented', cor: '#5A00F8', match: ['alugado'] },                 // roxo (destaque)
  { label: 'Available', cor: '#2FA84F', match: ['disponível', 'disponivel'] },
  { label: 'In preparation', cor: '#D4A017', match: ['em preparação', 'em preparacao', 'preparação', 'preparacao'] },
  { label: 'Workshop', cor: '#C2410C', match: ['oficina'] },               // laranja (mais escuro que "In preparation")
  { label: 'Total loss', cor: '#282728', match: ['perda total'] },
  { label: 'Sold', cor: '#6B7280', listrado: true, match: ['vendido', 'vendida', 'vendidos'] },
];

// ---- Ocorrências ----
const ocorrenciaTipos = [
  { label: 'Mechanical issue', barLabel: 'Mechanical', cor: '#5A00F8', match: ['problema mecânico', 'problema mecanico', 'mecânico', 'mecanico'] },
  { label: 'Collision', barLabel: 'Collision', cor: '#8B5CF6', match: ['colisão', 'colisao', 'batida'] },
  { label: 'Theft', barLabel: 'Theft', cor: '#A78BFA', match: ['roubo'] },
  { label: 'Total loss', barLabel: 'Total loss', cor: '#C9B8F0', match: ['perda total'] },
];
const churnTipos = [
  { label: 'Recovery', cor: '#5A00F8', match: ['recuperação', 'recuperacao'] },
  { label: 'Driver termination', cor: '#8B5CF6', match: ['rescisão pelo motorista', 'rescisao pelo motorista', 'rescisão', 'rescisao'] },
  { label: 'Claim – TL', cor: '#A78BFA', match: ['sinistro - pt', 'sinitro - pt', 'sinistro – pt', 'sinistro pt'] },
];
// Motivos que NÃO contam como rescisão (driver seguiu, só trocou de carro)
const churnExcluir = ['troca de carro', 'troca'];
const contratoNominalMeses = 12;

module.exports = {
  SHEET_ID, TABS, TAB_GIDS, UE_TABS, UE_PERIODS, UE_FLEET_COL, COBRANCAS_API, COBRANCAS_TOKEN,
  FROTA_API, FROTA_TOKEN, REVISOES_API, REVISAO_KM, modelos, corEsperado, mapModelo,
  spilloverDates, undatedReceivedDate,
  mLabels, mFull, esperado, semanaLabels, esperadoSemanal,
  proximoLote, notaMensal,
  statusItems, ocorrenciaTipos, churnTipos, churnExcluir, contratoNominalMeses,
};
