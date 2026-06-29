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
    console.log('✅ Banco de dados Supabase conectado!');
}
//# sourceMappingURL=database.js.map