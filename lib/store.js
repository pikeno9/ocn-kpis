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
  };
}

const SEP = '@@'; // separador de chave (não aparece em ids/rótulos)

function makeJson() {
  const file = path.join(__dirname, '..', 'data', 'ue-values.json');
  let mem = {};
  const key = (f, l, p) => `${f}${SEP}${l}${SEP}${p}`;
  const load = () => { try { mem = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { mem = {}; } };
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(mem, null, 2)); };
  return {
    name: 'json(dev)',
    async init() { load(); },
    async getFleet(fleetId) {
      return Object.entries(mem)
        .filter(([k]) => k.startsWith(fleetId + SEP))
        .map(([k, v]) => { const parts = k.split(SEP); return { line: parts[1], period: +parts[2], value: v.value, kind: v.kind }; });
    },
    async set({ fleetId, line, period, value, kind, user }) { mem[key(fleetId, line, period)] = { value, kind, updated_by: user || null }; save(); },
    async del({ fleetId, line, period }) { delete mem[key(fleetId, line, period)]; save(); },
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
};
