// =====================================================================
// OCN KPIs — fonte de dados do dashboard
// Tudo o que muda fica aqui, isolado, para facilitar edicao (e a futura
// edicao via painel admin). Numeros calculados a partir da planilha
// "import_data" e do calendario de recebimento (PPTX), em 24/06/2026.
// =====================================================================

const OCN = {
  ano: 2026,
  atualizadoEm: '24/06/2026',

  // Identidade dos modelos (color-code)
  modelos: {
    Polo: { label: 'Polo Track',  cor: '#B6BF69' },
    Argo: { label: 'Argo Drive',  cor: '#DBCB1E' },
    Tera: { label: 'Tera',        cor: '#B9A7E5' },
  },
  corEsperado: '#282728',

  // -------- VISAO MENSAL (grafico principal) --------
  mensal: {
    labels: ['Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
    full:   ['Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
    // Recebido por modelo (exceções aplicadas: 31/05 -> Junho; lote 19/06 -> Junho)
    recebido: {
      Polo: [50, 26,  0, 0, 0, 0, 0, 0, 0],
      Argo: [ 0, 30, 39, 0, 0, 0, 0, 0, 0],
      Tera: [ 0,  0, 18, 0, 0, 0, 0, 0, 0],
    },
    // Esperado (calendario). Abril nao consta no calendario => null
    esperadoTotal: [null, 56, 64, 74, 84, 94, 106, 121, 126],
    esperadoModelo: [
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
    // Abril nao e interativo (sem data esperada no calendario)
    interativo: [false, true, true, true, true, true, true, true, true],
  },

  // -------- DRILL-DOWN SEMANAL (ao clicar num mes) --------
  semanal: {
    labels: [['Sem 1', '1–7'], ['Sem 2', '8–14'], ['Sem 3', '15–21'], ['Sem 4', '22–28'], ['Sem 5', '29–31']],
    // indexado por mes (0=Abr ... 8=Dez)
    recebido: {
      Polo: { 0: [0, 50, 0, 0, 0], 1: [0, 26, 0, 0, 0], 2: [0, 0, 0, 0, 0] },
      Argo: { 0: [0, 0, 0, 0, 0],  1: [30, 0, 0, 0, 0], 2: [38, 0, 1, 0, 0] },
      Tera: { 2: [0, 0, 18, 0, 0] },
    },
    esperadoTotal: {
      1: [null, 56, null, null, null],
      2: [32, 32, null, null, null],
      3: [25, 25, 24, null, null],
      4: [28, 28, 28, null, null],
      5: [34, 30, 30, null, null],
      6: [36, 36, 34, null, null],
      7: [50, 50, 21, null, null],
      8: [126, null, null, null, null],
    },
    esperadoModelo: {
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
  },

  // -------- ACUMULADO --------
  acumulado: {
    recebido: {
      Polo: [50, 76, 76, null, null, null, null, null, null],
      Argo: [0, 30, 69, null, null, null, null, null, null],
      Tera: [0, 0, 18, null, null, null, null, null, null],
    },
    esperado: [50, 106, 170, 244, 328, 422, 528, 649, 775],
  },

  // -------- KPIs de topo --------
  // "Realizado <mês vigente>" é calculado automaticamente no app.js a partir
  // do mês atual (recebido vs. esperado do mês corrente).
  kpis: {
    recebidosAno: 163,
    recebidosBreakdown: '76 Polo · 69 Argo · 18 Tera',
    esperadoAno: 775,
    proximoLoteData: '02/07',
    proximoLoteDesc: '25 Polo',
  },

  // -------- Próximo lote (previsão exibida no gráfico principal) --------
  // Aparece como barra hachurada no mês/semana de chegada prevista.
  proximoLote: { mesIndex: 3, semanaIndex: 0, modelo: 'Polo', qtd: 25, dataLabel: '02/07' },

  notaMensal:
    'Exceções: 33 Argo de 31/05 contados em Junho · 18 Tera + 1 Argo de 19/06 (linhas sem data na base) incluídos em Junho · Nov capado em 121 (excedente do lote 19/11 → Dez = 126) · Abril sem esperado no calendário.',
};
