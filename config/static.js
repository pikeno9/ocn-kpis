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
};

// API do site de revisões (preços de revisão por modelo, em R$)
const REVISOES_API = process.env.REVISOES_API || 'https://frota-revisoes-production.up.railway.app';

// API do site de frota (odômetro + revisões reais por carro). Token só via env (repo público).
const FROTA_API = process.env.FROTA_API || 'https://ocn-frota.vercel.app/api/external';
const FROTA_TOKEN = process.env.FROTA_TOKEN || '';
const REVISAO_KM = 10000; // revisão a cada 10.000 km

// Unit Economics — abas de cashflow orçado (por veículo), uma por modelo
const UE_TABS = { Polo: 'UE - Polo', Argo: 'UE - Argo', Tera: 'UE - Tera' };
const UE_PERIODS = 12; // M1-M12; M0 = setup inicial (coluna 2 das abas UE)
const UE_FLEET_COL = 14; // coluna "O" (frota) em import_data = identifica a frota (1..n)

// Identidade dos modelos (color-code)
const modelos = {
  Polo: { label: 'Polo Track', cor: '#B6BF69', foto: 'cars/polo.png' },
  Argo: { label: 'Argo Drive', cor: '#DBCB1E', foto: 'cars/argo.webp' },
  Tera: { label: 'Tera', cor: '#B9A7E5', foto: 'cars/tera.png' },
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
const mLabels = ['Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const mFull = ['Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const esperado = {
  total: [null, 56, 64, 74, 84, 94, 106, 121, 126],
  modelo: [
    null,
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

const semanaLabels = [['Sem 1', '1–7'], ['Sem 2', '8–14'], ['Sem 3', '15–21'], ['Sem 4', '22–28'], ['Sem 5', '29–31']];
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
    1: 'Maio: 06/05 (30 Argo) e 13–14/05 (26 Polo). Esperado: 08/05 (30 Argo) + 13/05 (26 Polo).',
    2: 'Junho: 38 Argo no início (33 de 31/05 + 5 de 03/06) e 19/06 (18 Tera + 1 Argo). Esperado: 64 Polo. Os Tera chegaram ~2 meses antes do calendário (1º previsto em Ago).',
    7: 'Novembro: esperado capado em 121 (50+50+21 Tera).',
    8: 'Dezembro: 126 Tera no início do mês.',
  },
};

const proximoLote = { mesIndex: 3, semanaIndex: 0, modelo: 'Polo', qtd: 25, dataLabel: '02/07', desc: '25 Polo' };

const notaMensal =
  'Exceções: 33 Argo de 31/05 contados em Junho · 18 Tera + 1 Argo de 19/06 (linhas sem data na base) incluídos em Junho · Nov capado em 121 (excedente do lote 19/11 → Dez = 126) · Abril sem esperado no calendário.';

// ---- Status da frota (coluna Q). match = textos da planilha que caem nesse status ----
const statusItems = [
  { label: 'Alugados', cor: '#DB2D2D', match: ['alugado'] },
  { label: 'Disponível', cor: '#2FA84F', match: ['disponível', 'disponivel'] },
  { label: 'Em preparação', cor: '#D4A017', match: ['em preparação', 'em preparacao', 'preparação', 'preparacao'] },
  { label: 'Oficina', cor: '#5A00F8', match: ['oficina'] },
  { label: 'Perda total', cor: '#282728', match: ['perda total'] },
  { label: 'Vendidos', cor: '#6B7280', listrado: true, match: ['vendido', 'vendida', 'vendidos'] },
];

// ---- Ocorrências ----
const ocorrenciaTipos = [
  { label: 'Problema mecânico', barLabel: 'Mecânico', cor: '#5A00F8', match: ['problema mecânico', 'problema mecanico', 'mecânico', 'mecanico'] },
  { label: 'Colisão', barLabel: 'Colisão', cor: '#8B5CF6', match: ['colisão', 'colisao', 'batida'] },
  { label: 'Roubo', barLabel: 'Roubo', cor: '#A78BFA', match: ['roubo'] },
  { label: 'Perda total', barLabel: 'Perda total', cor: '#C9B8F0', match: ['perda total'] },
];
const churnTipos = [
  { label: 'Recuperação', cor: '#5A00F8', match: ['recuperação', 'recuperacao'] },
  { label: 'Rescisão pelo motorista', cor: '#8B5CF6', match: ['rescisão pelo motorista', 'rescisao pelo motorista', 'rescisão', 'rescisao'] },
  { label: 'Sinistro – PT', cor: '#A78BFA', match: ['sinistro - pt', 'sinitro - pt', 'sinistro – pt', 'sinistro pt'] },
];
// Motivos que NÃO contam como rescisão (driver seguiu, só trocou de carro)
const churnExcluir = ['troca de carro', 'troca'];
const contratoNominalMeses = 12;

module.exports = {
  SHEET_ID, TABS, UE_TABS, UE_PERIODS, UE_FLEET_COL, REVISOES_API, FROTA_API, FROTA_TOKEN, REVISAO_KM, modelos, corEsperado, mapModelo,
  spilloverDates, undatedReceivedDate,
  mLabels, mFull, esperado, semanaLabels, esperadoSemanal,
  proximoLote, notaMensal,
  statusItems, ocorrenciaTipos, churnTipos, churnExcluir, contratoNominalMeses,
};
