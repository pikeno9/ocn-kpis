// =====================================================================
// OCORRÊNCIAS (site) — puxa as ocorrências do painel de cobranças
// (GET /api/v1/frota -> placas[].ocorrencias[]) e MESCLA na aba
// "Ocorrencias" da planilha, que continua sendo a base histórica
// (as ocorrências do início da operação só existem lá).
//
// Dedup por PLACA + DATA: as ocorrências que já estão na planilha
// (hoje as #1..#10 do site) não entram de novo; só as novas (#11+).
// Keyed em placa+data (não no número do site) para ser robusto: se
// alguém digitar uma dessas na planilha depois, não duplica.
//
// O site NÃO classifica o TIPO (Batida/Roubo/Mecânico/Perda Total),
// então inferimos pelo texto do detalhamento (mesmo vocabulário da
// planilha). A inferência reproduz a classificação manual das #1..#10.
// =====================================================================
const C = require('./../config/static');

const cell = (r, i) => String(r && r[i] != null ? r[i] : '').trim();
const norm = (s) => String(s || '').replace(/\s+/g, '');

async function fetchSite() {
  if (!C.COBRANCAS_TOKEN) throw new Error('COBRANCAS_TOKEN não definido');
  const r = await fetch(C.COBRANCAS_API + '/api/v1/frota', { headers: { Authorization: 'Bearer ' + C.COBRANCAS_TOKEN } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const out = [];
  for (const p of (d && d.placas) || []) {
    for (const o of p.ocorrencias || []) {
      out.push({
        numero: o.numero,
        placa: String(p.placa || '').toUpperCase(),
        cliente: o.cliente || '',
        sinistro: o.sinistro || '',
        dataEvento: o.data_evento || '', // ISO YYYY-MM-DD
        detalhamento: o.detalhamento || '',
        oficina: o.local_oficina || '',
      });
    }
  }
  return out;
}

// TIPO no vocabulário da planilha, inferido do detalhamento (o site não classifica).
// Ordem importa: perda total > roubo/vidro > colisão > (default) mecânico.
function inferTipo(txt) {
  const t = String(txt || '').toLowerCase();
  if (/perda total/.test(t)) return 'Perda Total';
  if (/roubo|roubou|furto|assalt|bandido|vidro/.test(t)) return 'Roubo';
  if (/colis|colid|batida|bateu|guincho|acidente|abalro/.test(t)) return 'Batida';
  return 'Problema Mecânico';
}

// ISO (YYYY-MM-DD) -> DD/MM/YYYY (formato da coluna "Data do Evento")
function isoToBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// Devolve NOVAS linhas (formato de linha da aba Ocorrencias) para as ocorrências
// do site ainda ausentes da planilha, deduplicando por placa+data.
function mergeIntoSheet(sheetRows, siteOcorr) {
  const rows = sheetRows || [];
  const seen = new Set();
  let maxNum = 0;
  for (const r of rows) {
    const placa = cell(r, 1).toUpperCase();
    if (placa && placa.toLowerCase() !== 'placa') seen.add(placa + '|' + norm(cell(r, 3)));
    const n = parseInt(cell(r, 0), 10);
    if (Number.isFinite(n)) maxNum = Math.max(maxNum, n);
  }
  const extra = [];
  for (const o of siteOcorr || []) {
    const dataBR = isoToBR(o.dataEvento);
    if (!o.placa) continue;
    const key = o.placa + '|' + norm(dataBR);
    if (seen.has(key)) continue; // já está na planilha
    seen.add(key);
    const row = [];
    row[0] = String(++maxNum);           // # (continua a numeração da planilha)
    row[1] = o.placa;                    // Placa
    row[2] = o.cliente;                  // Cliente (o compute ainda cruza com import_clientes)
    row[3] = dataBR;                     // Data do Evento
    row[4] = o.sinistro;                 // Sinistro
    row[5] = '';                         // (coluna vazia da planilha)
    row[6] = o.detalhamento;             // Detalhamento
    row[7] = o.oficina;                  // Oficina
    row[8] = inferTipo(o.detalhamento);  // TIPO (inferido do detalhamento)
    extra.push(row);
  }
  return rows.concat(extra);
}

module.exports = { fetchSite, mergeIntoSheet, inferTipo };
