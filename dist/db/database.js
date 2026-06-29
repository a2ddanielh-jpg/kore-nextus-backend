"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.pool = void 0;
exports.initDatabase = initDatabase;

// ─────────────────────────────────────────────────────────────────────────────
// Supabase REST API adapter — uses kore_exec() PostgreSQL function to run
// arbitrary SQL via HTTPS instead of a direct pg connection (IPv6-only on
// Supabase, not routable from Render free tier).
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Shim for any routes that import pool directly
exports.pool = {
    query: async () => {
        throw new Error('pool.query() disabled — use db.prepare()');
    }
};

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ...
function toPostgres(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

// Execute SQL via the kore_exec() PostgreSQL function in Supabase
async function execViaRPC(sql, params) {
    const pgSql = toPostgres(sql);
    // Supabase RPC: POST /rest/v1/rpc/kore_exec
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/kore_exec`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
        },
        body: JSON.stringify({
            q: pgSql,
            p: params.map(v => (v === null || v === undefined) ? null : String(v)),
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`kore_exec failed (${res.status}): ${text}`);
    }

    const raw = await res.text();
    if (!raw || raw === 'null') return [];

    // kore_exec returns a JSON array (stringified)
    try {
        const parsed = JSON.parse(raw);
        // The RPC response might be a JSON string containing the array
        if (typeof parsed === 'string') return JSON.parse(parsed);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// SQLite-compatible async wrapper
exports.db = {
    prepare: (sql) => {
        return {
            get: async (...params) => {
                const rows = await execViaRPC(sql, params.flat());
                return rows[0] ?? null;
            },
            all: async (...params) => {
                return await execViaRPC(sql, params.flat());
            },
            run: async (...params) => {
                await execViaRPC(sql, params.flat());
            },
        };
    },
};

async function initDatabase() {
    console.log('🗄️  Conectando ao Supabase via REST API...');
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios');
    }
    // Smoke test via kore_exec
    const rows = await execViaRPC('SELECT 1 AS ok', []);
    if (!rows || rows[0]?.ok !== 1) {
        throw new Error('kore_exec smoke test failed');
    }
    console.log('✅ Supabase REST API (kore_exec) conectada!');
}
