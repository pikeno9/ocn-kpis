// =====================================================================
// REVISÕES — puxa os preços de revisão (R$) do site frota-revisoes
// e monta { Polo: [{n, km, valor}], Argo: [...], Tera: [...] }.
// =====================================================================
const C = require('../config/static');

async function fetchRevisoes() {
  const base = C.REVISOES_API;
  const [veic, precos] = await Promise.all([
    fetch(base + '/api/veiculos').then((r) => r.json()),
    fetch(base + '/api/precos').then((r) => r.json()),
  ]);

  const idToModel = {};
  (Array.isArray(veic) ? veic : []).forEach((v) => {
    const m = C.mapModelo(`${v.apelido || ''} ${v.modelo || ''}`);
    if (m) idToModel[v.id] = m;
  });

  const out = {};
  // A API devolve CADA preço duplicado (mesma revisão, mesmo valor, 2x). Sem deduplicar,
  // quem soma a lista (em vez de usar find) contabiliza a revisão em dobro. Mantém 1 por revisão.
  const seen = {};
  (Array.isArray(precos) ? precos : []).forEach((p) => {
    const model = idToModel[p.veiculo_id];
    if (!model) return;
    const nM = String(p.revisao || '').match(/^\s*(\d+)/);
    const kmM = String(p.revisao || '').match(/\(([\d.]+)/);
    const n = nM ? +nM[1] : null;
    const km = kmM ? +kmM[1].replace(/\./g, '') : (n ? n * 10000 : null);
    const valor = Number(p.valor);
    if (!n || !km || !isFinite(valor)) return;
    const key = model + '|' + n;
    if (seen[key]) return; // duplicata da API
    seen[key] = true;
    if (!out[model]) out[model] = [];
    out[model].push({ n, km, valor });
  });
  Object.values(out).forEach((arr) => arr.sort((a, b) => a.n - b.n));
  return out;
}

module.exports = { fetchRevisoes };
