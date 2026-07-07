// =====================================================================
// PAYMENTS — inadimplência semanal (matriz de pagamentos por placa) +
// eventos de churn (recuperação/devolução, do import_clientes).
//
// Categorias por semana (vencimento = segunda-feira da cobrança):
//   onTime   = pago no prazo OU abonado (mesclados a pedido do usuário)
//   late1    = pago com 1 dia de atraso
//   late2    = pago com 2+ dias de atraso
//   recovered/returned = contrato encerrado naquela semana (Motivo Fim
//     Vínculo do import_clientes: "Recuperação" / "Rescisão pelo motorista")
//
// "Pendente" (semana ainda sem pagamento registrado) fica de fora —
// decisão do usuário: só conta o que já foi resolvido.
// A matriz não expõe motivo de cancelamento, por isso o cruzamento com
// a planilha principal (aproximado — pode divergir levemente do site).
// =====================================================================
const C = require('../config/static');

const cell = (r, i) => String(r && r[i] != null ? r[i] : '').trim();

async function fetchMatriz() {
  if (!C.COBRANCAS_TOKEN) throw new Error('COBRANCAS_TOKEN não definido');
  const r = await fetch(C.COBRANCAS_API + '/api/v1/matriz', {
    headers: { Authorization: 'Bearer ' + C.COBRANCAS_TOKEN },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// /api/v1/resumo -> { vencimento(YYYY-MM-DD): esperado_qtd }. O "Esperado" é o
// denominador que o site usa (cobranças previstas na semana, incl. as não pagas).
async function fetchResumo() {
  if (!C.COBRANCAS_TOKEN) throw new Error('COBRANCAS_TOKEN não definido');
  const r = await fetch(C.COBRANCAS_API + '/api/v1/resumo', {
    headers: { Authorization: 'Bearer ' + C.COBRANCAS_TOKEN },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const map = {};
  for (const s of (d && d.semanas) || []) { if (s.vencimento != null && s.esperado_qtd != null) map[s.vencimento] = s.esperado_qtd; }
  return map;
}

const toKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
// segunda-feira da semana que contém (y,m,d) — mesmo grid da coluna "vencimento" da matriz
function mondayKeyOf(y, m, d) {
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0=domingo..6=sábado
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return toKey(dt);
}
// Datas do import_clientes vêm em formato MISTO: as digitadas com zero à esquerda ("03/07") são D/M;
// as auto-formatadas pelo Google Sheets ("7/2") vêm SEM zero e são M/D. Desambigua pelo padding.
function parseDataBR(s) {
  const p = String(s || '').trim().split('/');
  if (p.length !== 3) return null;
  const a = +p[0], b = +p[1], y = +p[2];
  if (!a || !b || !y) return null;
  let d, m;
  if (a > 12) { d = a; m = b; }                                 // 1º campo > 12 → D/M
  else if (b > 12) { m = a; d = b; }                            // 2º campo > 12 → M/D
  else if (p[0].length === 1 || p[1].length === 1) { m = a; d = b; } // sem zero à esquerda → export M/D do Sheets
  else { d = a; m = b; }                                        // com zero à esquerda → D/M digitado
  return { y, m, d };
}
// motivo (col M import_clientes) -> categoria de churn, ou null se não se aplica
function churnCategory(motivo) {
  const m = motivo.toLowerCase();
  if (/recupera/.test(m)) return 'recovered';
  if (/rescis[aã]o pelo motorista/.test(m)) return 'returned';
  return null; // sinistro/troca de carro/etc. não entram aqui
}

// Pagamentos confirmados MANUALMENTE que a matriz/site de referência ainda não refletem.
// Remover quando a API atualizar. (bucket: onTime | late1 | late2)
const MANUAL_PAYMENTS = [
  { vencimento: '2026-06-29', bucket: 'late2', nome: 'Fabio Aparecido Cardoso Smith Junior', placa: 'TKB0F63', recebido: 838.95, esperado: 799 },
];

function build(matrizData, clientesRows, refDate, esperadoMap) {
  const esp = esperadoMap || {};
  const weeks = {}; // vencimento (YYYY-MM-DD) -> { onTime:[], late1:[], late2:[], recovered:[], returned:[], pending:[] }
  const ensure = (k) => (weeks[k] = weeks[k] || { onTime: [], late1: [], late2: [], recovered: [], returned: [], pending: [] });
  let minWeek = null, maxWeek = null; // intervalo real de cobrança (só o que veio da matriz)

  for (const p of (matrizData && matrizData.placas) || []) {
    for (const v of p.vinculos || []) {
      // valor por vencimento (esperado/recebido por semana) — p/ mostrar o R$ na lista
      const valByVenc = {};
      for (const ps of (v.valores && v.valores.por_semana) || []) valByVenc[ps.vencimento] = ps;
      for (const s of v.semanas_pagas || []) {
        if (s.semana === 0) continue; // retirada = entrega, não é parcela semanal
        const w = ensure(s.vencimento);
        if (minWeek == null || s.vencimento < minWeek) minWeek = s.vencimento;
        if (maxWeek == null || s.vencimento > maxWeek) maxWeek = s.vencimento;
        const pv = valByVenc[s.vencimento] || {};
        const item = { nome: v.cliente || 'Unknown', placa: p.placa, recebido: pv.recebido != null ? pv.recebido : null, esperado: pv.esperado != null ? pv.esperado : null };
        if (s.tipo === 'abonado' || s.tipo === 'pago') { w.onTime.push(item); continue; }
        if (s.tipo === 'pago_atrasado') {
          const venc = new Date(s.vencimento + 'T12:00:00'), pago = s.pago_em ? new Date(s.pago_em.slice(0, 10) + 'T12:00:00') : null;
          const delay = pago ? Math.round((pago - venc) / 86400000) : 1;
          (delay >= 2 ? w.late2 : w.late1).push(item);
        }
      }
    }
  }
  // teto = semana vigente (não faz sentido mostrar semanas futuras numa visão de inadimplência histórica)
  const hoje = refDate || new Date();
  const todayKey = mondayKeyOf(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
  if (maxWeek == null || todayKey < maxWeek) maxWeek = todayKey;

  for (const r of clientesRows || []) {
    if (cell(r, 11).toLowerCase() !== 'inativo') continue; // só vínculos encerrados
    const cat = churnCategory(cell(r, 12));
    if (!cat) continue;
    const dt = parseDataBR(cell(r, 10)); // col K = Data Fim Vínculo
    if (!dt) continue;
    const key = mondayKeyOf(dt.y, dt.m, dt.d);
    if (minWeek != null && (key < minWeek || key > maxWeek)) continue; // fora do período coberto pela matriz = ruído (data mal preenchida)
    const w = ensure(key);
    w[cat].push({ nome: cell(r, 1) || 'Unknown', placa: cell(r, 6).toUpperCase() });
  }

  // PENDENTES (não pagamento): entradas "em_aberto" de valores.por_semana — nome + valor esperado.
  // É a fonte do Pendente por pessoa (a matriz semanas_pagas só traz o que foi pago).
  for (const p of (matrizData && matrizData.placas) || []) {
    for (const v of p.vinculos || []) {
      if (v.cancelado) continue; // contrato cancelado deixa em_aberto "fantasma" — não é pendência real
      for (const ps of (v.valores && v.valores.por_semana) || []) {
        if (ps.status !== 'em_aberto') continue;
        const k = ps.vencimento;
        if (k > maxWeek || (minWeek != null && k < minWeek)) continue; // fora do período coberto
        ensure(k).pending.push({ nome: v.cliente || 'Unknown', placa: p.placa, recebido: 0, esperado: ps.esperado != null ? ps.esperado : null });
      }
    }
  }
  // pagamentos manuais (API ainda não reflete)
  for (const mp of MANUAL_PAYMENTS) {
    const k = mp.vencimento;
    if (k > maxWeek || (minWeek != null && k < minWeek)) continue;
    ensure(k)[mp.bucket].push({ nome: mp.nome, placa: mp.placa, recebido: mp.recebido, esperado: mp.esperado });
  }
  // garante que toda semana do resumo apareça — casa com o site
  for (const k of Object.keys(esp)) { if (k <= maxWeek) ensure(k); }

  const dates = Object.keys(weeks).filter((k) => k <= maxWeek).sort();
  return {
    weeks: dates.map((k) => {
      const w = weeks[k];
      const resolved = w.onTime.length + w.late1.length + w.late2.length + w.recovered.length + w.returned.length;
      const esperado = esp[k] != null ? esp[k] : resolved;
      // Opção A: só a semana VIGENTE (maxWeek) mostra Pendente. Semanas passadas já estão fechadas e o
      // "pending" residual delas é ruído do descasamento resumo(esperado) × matriz(pago) — então zera.
      const isCurrentWeek = (k >= maxWeek);
      const pendingCount = isCurrentWeek ? Math.max(0, esperado - resolved) : 0;
      return {
        date: k,
        esperado,
        counts: { onTime: w.onTime.length, late1: w.late1.length, late2: w.late2.length, returned: w.returned.length, recovered: w.recovered.length, pending: pendingCount },
        names: isCurrentWeek ? w : { ...w, pending: [] }, // semanas passadas: sem pendentes na lista tbm
      };
    }),
  };
}

module.exports = { fetchMatriz, fetchResumo, build };
