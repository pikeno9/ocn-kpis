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
// heurística D/M e M/D (mesma usada em compute.js/ue.js para as demais datas da planilha)
function parseDataBR(s) {
  const p = String(s || '').split('/');
  if (p.length !== 3) return null;
  let a = +p[0], b = +p[1]; const y = +p[2];
  let d, m;
  if (a > 12) { d = a; m = b; } else if (b > 12) { m = a; d = b; } else { d = a; m = b; }
  if (!d || !m || !y) return null;
  return { y, m, d };
}
// motivo (col M import_clientes) -> categoria de churn, ou null se não se aplica
function churnCategory(motivo) {
  const m = motivo.toLowerCase();
  if (/recupera/.test(m)) return 'recovered';
  if (/rescis[aã]o pelo motorista/.test(m)) return 'returned';
  return null; // sinistro/troca de carro/etc. não entram aqui
}

function build(matrizData, clientesRows, refDate, esperadoMap) {
  const esp = esperadoMap || {};
  const weeks = {}; // vencimento (YYYY-MM-DD) -> { onTime:[], late1:[], late2:[], recovered:[], returned:[] }
  const ensure = (k) => (weeks[k] = weeks[k] || { onTime: [], late1: [], late2: [], recovered: [], returned: [] });
  let minWeek = null, maxWeek = null; // intervalo real de cobrança (só o que veio da matriz)

  for (const p of (matrizData && matrizData.placas) || []) {
    for (const v of p.vinculos || []) {
      for (const s of v.semanas_pagas || []) {
        if (s.semana === 0) continue; // retirada = entrega, não é parcela semanal
        const w = ensure(s.vencimento);
        if (minWeek == null || s.vencimento < minWeek) minWeek = s.vencimento;
        if (maxWeek == null || s.vencimento > maxWeek) maxWeek = s.vencimento;
        const item = { nome: v.cliente || 'Unknown', placa: p.placa };
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

  // garante que toda semana do resumo (mesmo sem pagamento registrado) apareça — casa com o site
  for (const k of Object.keys(esp)) { if (k <= maxWeek) ensure(k); }

  const dates = Object.keys(weeks).filter((k) => k <= maxWeek).sort();
  return {
    weeks: dates.map((k) => {
      const w = weeks[k];
      const resolved = w.onTime.length + w.late1.length + w.late2.length + w.recovered.length + w.returned.length;
      // Esperado (denominador do site); se a semana não estiver no resumo, cai no resolvido (comportamento antigo)
      const esperado = esp[k] != null ? esp[k] : resolved;
      const pending = Math.max(0, esperado - resolved); // Pendente = Esperado − tudo que já foi resolvido
      return {
        date: k,
        esperado,
        counts: { onTime: w.onTime.length, late1: w.late1.length, late2: w.late2.length, returned: w.returned.length, recovered: w.recovered.length, pending },
        names: w, // "pending" não tem nomes (a matriz só traz semanas pagas)
      };
    }),
  };
}

module.exports = { fetchMatriz, fetchResumo, build };
