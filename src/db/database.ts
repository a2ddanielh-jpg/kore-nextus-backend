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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_name TEXT NOT NULL,
      client_code TEXT NOT NULL,
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
  await pool.query(`ALTER TABLE agency_projects ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  console.log('✅ Banco de dados Supabase conectado!');
}
