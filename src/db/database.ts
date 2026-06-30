const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export const pool = {
  query: async (): Promise<never> => {
    throw new Error('pool.query() disabled; use db.prepare()');
  },
};

function toPostgres(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function execViaRpc(sql: string, params: any[]): Promise<any[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/kore_exec`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      q: toPostgres(sql),
      p: params.map((value) => (value === null || value === undefined ? null : String(value))),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`kore_exec failed (${response.status}): ${text}`);
  }

  const text = await response.text();
  if (!text || text === 'null') return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'string') {
      const inner = JSON.parse(parsed);
      return Array.isArray(inner) ? inner : [];
    }
    return [];
  } catch {
    return [];
  }
}

export const db = {
  prepare: (sql: string) => ({
    get: async (...params: any[]): Promise<any | null> => {
      const rows = await execViaRpc(sql, params.flat());
      return rows[0] ?? null;
    },
    all: async (...params: any[]): Promise<any[]> => {
      return execViaRpc(sql, params.flat());
    },
    run: async (...params: any[]): Promise<void> => {
      await execViaRpc(sql, params.flat());
    },
  }),
};

export async function initDatabase(): Promise<void> {
  console.log('Connecting to Supabase via REST API...');
  const rows = await execViaRpc('SELECT 1 AS ok', []);
  if (Number(rows[0]?.ok) !== 1) {
    throw new Error('kore_exec smoke test failed');
  }
  console.log('Supabase REST API connected');
}
