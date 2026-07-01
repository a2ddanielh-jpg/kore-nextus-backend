-- ============================================================
-- KORE NEXTUS — PostgreSQL Schema (Supabase)
-- Rodar no SQL Editor do Supabase: https://supabase.com/dashboard
-- ============================================================

-- Configurações da empresa
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  company_name TEXT NOT NULL DEFAULT 'Kore Nextus',
  cnpj TEXT DEFAULT '',
  inscricao_municipal TEXT DEFAULT '',
  razao_social TEXT DEFAULT '',
  endereco TEXT DEFAULT '',
  municipio TEXT DEFAULT 'Caxias do Sul',
  uf TEXT DEFAULT 'RS',
  cep TEXT DEFAULT '',
  telefone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  regime_tributario INTEGER DEFAULT 1,
  aliquota_iss NUMERIC DEFAULT 2.0,
  codigo_servico TEXT DEFAULT '',
  tax_reserve_percent NUMERIC DEFAULT 6.0,
  certificate_path TEXT DEFAULT '',
  certificate_password TEXT DEFAULT '',
  nfse_environment TEXT DEFAULT 'homologacao',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO settings (id, company_name) VALUES (1, 'Kore Nextus') ON CONFLICT (id) DO NOTHING;

-- Clientes
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cpf_cnpj TEXT NOT NULL,
  tipo_pessoa TEXT NOT NULL DEFAULT 'J',
  razao_social TEXT DEFAULT '',
  email TEXT DEFAULT '',
  telefone TEXT DEFAULT '',
  endereco TEXT DEFAULT '',
  numero TEXT DEFAULT '',
  complemento TEXT DEFAULT '',
  bairro TEXT DEFAULT '',
  municipio TEXT DEFAULT '',
  uf TEXT DEFAULT '',
  cep TEXT DEFAULT '',
  codigo_municipio TEXT DEFAULT '',
  asaas_customer_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transações
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Outros',
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','cancelled')),
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  nfse_id TEXT,
  notes TEXT DEFAULT '',
  tax_reserve_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gastos Fixos
CREATE TABLE IF NOT EXISTS fixed_expenses (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL DEFAULT 'Operacional',
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK(frequency IN ('monthly','quarterly','yearly')),
  due_day INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  end_date TEXT DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reservas de Impostos
CREATE TABLE IF NOT EXISTS tax_reserves (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  percent NUMERIC NOT NULL DEFAULT 6.0,
  reference_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled')),
  paid_date TEXT DEFAULT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- NFS-e
CREATE TABLE IF NOT EXISTS nfse_records (
  id TEXT PRIMARY KEY,
  numero_nfse TEXT DEFAULT '',
  numero_rps TEXT NOT NULL,
  serie_rps TEXT NOT NULL DEFAULT '1',
  tipo_rps TEXT NOT NULL DEFAULT 'RPS',
  data_emissao TEXT NOT NULL,
  competencia TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  discriminacao TEXT NOT NULL,
  codigo_servico TEXT NOT NULL,
  valor_servicos NUMERIC NOT NULL,
  valor_deducoes NUMERIC DEFAULT 0,
  valor_pis NUMERIC DEFAULT 0,
  valor_cofins NUMERIC DEFAULT 0,
  valor_inss NUMERIC DEFAULT 0,
  valor_ir NUMERIC DEFAULT 0,
  valor_csll NUMERIC DEFAULT 0,
  iss_retido INTEGER DEFAULT 0,
  valor_iss NUMERIC DEFAULT 0,
  aliquota_iss NUMERIC DEFAULT 2.0,
  valor_liquido NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','authorized','cancelled','error')),
  xml_rps TEXT DEFAULT '',
  xml_nfse TEXT DEFAULT '',
  numero_protocolo TEXT DEFAULT '',
  codigo_verificacao TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  transaction_id TEXT REFERENCES transactions(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cobranças
CREATE TABLE IF NOT EXISTS cobrancas (
  id TEXT PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  valor NUMERIC NOT NULL,
  descricao TEXT NOT NULL,
  codigo_servico TEXT DEFAULT '1.07',
  aliquota_iss NUMERIC DEFAULT 2.0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','cancelled','error')),
  vencimento TEXT DEFAULT NULL,
  payment_methods TEXT NOT NULL DEFAULT 'pix,card',
  provider TEXT DEFAULT 'asaas',
  provider_payment_id TEXT DEFAULT '',
  provider_invoice_id TEXT DEFAULT '',
  nfse_numero TEXT DEFAULT '',
  picpay_payment_url TEXT DEFAULT '',
  picpay_qr_content TEXT DEFAULT '',
  picpay_qr_base64 TEXT DEFAULT '',
  picpay_expires_at TEXT DEFAULT '',
  paid_at TIMESTAMPTZ DEFAULT NULL,
  paid_method TEXT DEFAULT NULL,
  authorization_id TEXT DEFAULT NULL,
  nfse_id TEXT REFERENCES nfse_records(id),
  transaction_id TEXT REFERENCES transactions(id),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Proyectos de agencia (creados automáticamente desde CRM leads cerrados)
CREATE TABLE IF NOT EXISTS agency_projects (
  id                    SERIAL PRIMARY KEY,
  client_name           TEXT NOT NULL,
  client_code           TEXT NOT NULL DEFAULT '',
  production_start_date TEXT NOT NULL,
  deadline_days         INTEGER NOT NULL DEFAULT 30,
  estimated_delivery_date TEXT NOT NULL,
  total_amount          NUMERIC NOT NULL DEFAULT 0,
  amount_paid           NUMERIC NOT NULL DEFAULT 0,
  net_amount            NUMERIC NOT NULL DEFAULT 0,
  payment_method        TEXT NOT NULL DEFAULT 'pix',
  project_link          TEXT NOT NULL DEFAULT '',
  briefing_link         TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'em_producao'
                        CHECK(status IN ('em_producao','entregue','revisao','cancelado')),
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Función RPC para ejecutar SQL arbitrario desde el backend via REST API
-- Necesaria porque Render free tier no permite conexión directa a Supabase por IPv6
CREATE OR REPLACE FUNCTION kore_exec(q TEXT, p TEXT[] DEFAULT '{}')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', q)
    USING p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10],
          p[11], p[12], p[13], p[14], p[15], p[16], p[17], p[18], p[19], p[20]
  INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Índices
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_cobrancas_public_id ON cobrancas(public_id);
CREATE INDEX IF NOT EXISTS idx_cobrancas_status ON cobrancas(status);
CREATE INDEX IF NOT EXISTS idx_fixed_expenses_active ON fixed_expenses(is_active);
CREATE INDEX IF NOT EXISTS idx_agency_projects_status ON agency_projects(status);
CREATE INDEX IF NOT EXISTS idx_agency_projects_created ON agency_projects(created_at DESC);
