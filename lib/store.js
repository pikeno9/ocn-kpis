// =====================================================================
// STORE — persistência dos valores realizados/projetados (Unit Economics).
// Produção: Postgres (DATABASE_URL, ex.: serviço Postgres do Railway).
// Dev local: arquivo JSON em ./data/ue-values.json (sem precisar de banco).
// Interface: getFleet(fleetId), set(cell), del(cell).
// =====================================================================
const fs = require('fs');
const path = require('path');

let backend = null;

function makePg() {
  const { Pool } = require('pg');
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
  return {
    name: 'postgres',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS ue_values (
        fleet_id text NOT NULL,
        line text NOT NULL,
        period int NOT NULL,
        value double precision,
        kind text NOT NULL,
        updated_by text,
        updated_at timestamptz DEFAULT now(),
        PRIMARY KEY (fleet_id, line, period)
      );`);
      await pool.query(`CREATE TABLE IF NOT EXISTS kv_docs (
        key text PRIMARY KEY,
        value text,
        updated_by text,
        updated_at timestamptz DEFAULT now()
      );`);
    },
    async getDoc(key) {
      const r = await pool.query('SELECT value FROM kv_docs WHERE key=$1', [key]);
      if (!r.rows.length) return null;
      try { return JSON.parse(r.rows[0].value); } catch (e) { return null; }
    },
    async setDoc(key, obj, user) {
      await pool.query(
        `INSERT INTO kv_docs (key, value, updated_by, updated_at) VALUES ($1,$2,$3, now())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [key, JSON.stringify(obj), user || null]
      );
    },
    async getFleet(fleetId) {
      const r = await pool.query('SELECT line, period, value, kind FROM ue_values WHERE fleet_id=$1', [fleetId]);
      return r.rows.map((x) => ({ line: x.line, period: x.period, value: x.value, kind: x.kind }));
    },
    async set({ fleetId, line, period, value, kind, user }) {
      await pool.query(
        `INSERT INTO ue_values (fleet_id, line, period, value, kind, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (fleet_id, line, period)
         DO UPDATE SET value=EXCLUDED.value, kind=EXCLUDED.kind, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [fleetId, line, period, value, kind, user || null]
      );
    },
    async del({ fleetId, line, period }) {
      await pool.query('DELETE FROM ue_values WHERE fleet_id=$1 AND line=$2 AND period=$3', [fleetId, line, period]);
    },
    async dumpAll() {
      const uv = await pool.query('SELECT fleet_id, line, period, value, kind FROM ue_values');
      const kv = await pool.query('SELECT key, value FROM kv_docs');
      const docs = {};
      for (const r of kv.rows) { try { docs[r.key] = JSON.parse(r.value); } catch (e) {} }
      return {
        ue_values: uv.rows.map((x) => ({ fleetId: x.fleet_id, line: x.line, period: x.period, value: x.value, kind: x.kind })),
        docs,
      };
    },
  };
}

const SEP = '@@'; // separador de chave (não aparece em ids/rótulos)

function makeJson() {
  const file = path.join(__dirname, '..', 'data', 'ue-values.json');
  const docFile = path.join(__dirname, '..', 'data', 'docs.json');
  let mem = {}, docs = {};
  const key = (f, l, p) => `${f}${SEP}${l}${SEP}${p}`;
  const load = () => { try { mem = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { mem = {}; } };
  const loadDocs = () => { try { docs = JSON.parse(fs.readFileSync(docFile, 'utf8')); } catch (e) { docs = {}; } };
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(mem, null, 2)); };
  const saveDocs = () => { fs.mkdirSync(path.dirname(docFile), { recursive: true }); fs.writeFileSync(docFile, JSON.stringify(docs, null, 2)); };
  return {
    name: 'json(dev)',
    async init() { load(); loadDocs(); },
    async getFleet(fleetId) {
      return Object.entries(mem)
        .filter(([k]) => k.startsWith(fleetId + SEP))
        .map(([k, v]) => { const parts = k.split(SEP); return { line: parts[1], period: +parts[2], value: v.value, kind: v.kind }; });
    },
    async set({ fleetId, line, period, value, kind, user }) { mem[key(fleetId, line, period)] = { value, kind, updated_by: user || null }; save(); },
    async del({ fleetId, line, period }) { delete mem[key(fleetId, line, period)]; save(); },
    async getDoc(k) { return docs[k] || null; },
    async setDoc(k, obj, user) { docs[k] = obj; saveDocs(); },
    async dumpAll() {
      const ue_values = Object.entries(mem).map(([k, v]) => {
        const parts = k.split(SEP);
        return { fleetId: parts[0], line: parts[1], period: +parts[2], value: v.value, kind: v.kind };
      });
      return { ue_values, docs: { ...docs } };
    },
  };
}

async function init() {
  backend = process.env.DATABASE_URL ? makePg() : makeJson();
  await backend.init();
  console.log('[store] backend:', backend.name);
}

module.exports = {
  init,
  getFleet: (...a) => backend.getFleet(...a),
  set: (...a) => backend.set(...a),
  del: (...a) => backend.del(...a),
  getDoc: (...a) => backend.getDoc(...a),
  setDoc: (...a) => backend.setDoc(...a),
  dumpAll: (...a) => backend.dumpAll(...a),
};
