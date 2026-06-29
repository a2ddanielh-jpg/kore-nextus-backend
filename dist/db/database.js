"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.pool = void 0;
exports.initDatabase = initDatabase;
const pg_1 = require("pg");
const connectionString = process.env.DATABASE_URL;
exports.pool = new pg_1.Pool({
    connectionString,
    ssl: connectionString?.includes('supabase.co')
        ? { rejectUnauthorized: false }
        : false,
    max: 10,
});
// Convert SQLite ? placeholders to PostgreSQL $1, $2, ...
function toPostgres(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}
// SQLite-compatible async wrapper — minimises changes in route files
exports.db = {
    prepare: (sql) => {
        const pgSql = toPostgres(sql);
        return {
            // Returns first row or undefined
            get: async (...params) => {
                const values = params.flat();
                const result = await exports.pool.query(pgSql, values);
                return result.rows[0] ?? null;
            },
            // Returns all rows
            all: async (...params) => {
                const values = params.flat();
                const result = await exports.pool.query(pgSql, values);
                return result.rows;
            },
            // Execute without returning rows
            run: async (...params) => {
                const values = params.flat();
                await exports.pool.query(pgSql, values);
            },
        };
    },
};
async function initDatabase() {
    console.log('🗄️  Conectando ao Supabase PostgreSQL...');
    await exports.pool.query('SELECT 1');
    await exports.pool.query(`
        CREATE TABLE IF NOT EXISTS agency_projects (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_name TEXT NOT NULL,
            client_code TEXT NOT NULL DEFAULT '',
            production_start_date DATE NOT NULL,
            deadline_days INTEGER NOT NULL DEFAULT 30,
            estimated_delivery_date DATE NOT NULL,
            total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
            amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
            net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
            payment_method TEXT NOT NULL DEFAULT 'pix',
            project_link TEXT DEFAULT '',
            briefing_link TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'em_producao',
            notes TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Migração: adiciona gateway_fee se a tabela já existia sem ela
    await exports.pool.query(`ALTER TABLE agency_projects ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
    await exports.pool.query(`ALTER TABLE agency_projects DROP COLUMN IF EXISTS gateway_fee`);
    console.log('✅ Banco de dados Supabase conectado!');
}
//# sourceMappingURL=database.js.map