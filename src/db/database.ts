import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('supabase.co')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
});

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ...
function toPostgres(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// SQLite-compatible async wrapper — minimises changes in route files
export const db = {
  prepare: (sql: string) => {
    const pgSql = toPostgres(sql);
    return {
      // Returns first row or undefined
      get: async (...params: any[]): Promise<any> => {
        const values = params.flat();
        const result = await pool.query(pgSql, values);
        return result.rows[0] ?? null;
      },
      // Returns all rows
      all: async (...params: any[]): Promise<any[]> => {
        const values = params.flat();
        const result = await pool.query(pgSql, values);
        return result.rows;
      },
      // Execute without returning rows
      run: async (...params: any[]): Promise<void> => {
        const values = params.flat();
        await pool.query(pgSql, values);
      },
    };
  },
};

export async function initDatabase(): Promise<void> {
  console.log('🗄️  Conectando ao Supabase PostgreSQL...');
  await pool.query('SELECT 1');
  console.log('✅ Banco de dados Supabase conectado!');
}
