// Force IPv4 DNS resolution — Render free tier does not route IPv6
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initDatabase } from './db/database';
import { requireAuth } from './middleware/auth';
import dashboardRoutes from './routes/dashboard.routes';
import transactionRoutes from './routes/transaction.routes';
import fixedExpenseRoutes from './routes/fixedExpense.routes';
import taxReserveRoutes from './routes/taxReserve.routes';
import nfseRoutes from './routes/nfse.routes';
import clientRoutes from './routes/client.routes';
import settingsRoutes from './routes/settings.routes';
import cobrancaRoutes from './routes/cobranca.routes';
import pacoteRoutes from './routes/pacote.routes';
import webhookRoutes from './routes/webhook.routes';
import agencyProjectRoutes from './routes/agencyProject.routes';
import internalRoutes from './routes/internal.routes';

const app = express();
const PORT = process.env.PORT || 3001;

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'https://gestion.korenextus.com',
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, webhooks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, true); // permissive for now — lock down after deploy confirmed
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded certificates
app.use('/certificates', express.static(path.join(__dirname, '../certificates')));

// ─────────────────────────────────────────────
// PUBLIC routes — no auth required
// ─────────────────────────────────────────────

// Mercado Pago webhook — must be public (MP calls this)
app.use('/api/webhooks', webhookRoutes);

// Public checkout data (used by the checkout React page)
app.get('/api/cobrancas/public/:public_id', (req, res, next) => {
  req.url = `/public/${req.params.public_id}`;
  cobrancaRoutes(req, res, next);
});

// Public card payment — Mercado Pago Bricks posts token here (no auth required)
app.post('/api/cobrancas/public/:public_id/pay-card', (req, res, next) => {
  req.url = `/public/${req.params.public_id}/pay-card`;
  cobrancaRoutes(req, res, next);
});

// Package checkout — public (called from landing page)
app.use('/api/pacotes', pacoteRoutes);

// Internal webhook — called by Kore Nextus CRM (secret-protected, no JWT)
app.use('/api/internal', internalRoutes);
app.use('/internal', internalRoutes);

// Health check — public
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// PROTECTED routes — require valid Supabase JWT
// ─────────────────────────────────────────────
app.use('/api/dashboard',       requireAuth, dashboardRoutes);
app.use('/api/transactions',    requireAuth, transactionRoutes);
app.use('/api/fixed-expenses',  requireAuth, fixedExpenseRoutes);
app.use('/api/tax-reserve',     requireAuth, taxReserveRoutes);
app.use('/api/nfse',            requireAuth, nfseRoutes);
app.use('/api/clients',          requireAuth, clientRoutes);
app.use('/api/agency-projects', requireAuth, agencyProjectRoutes);
app.use('/api/settings',        requireAuth, settingsRoutes);
app.use('/api/cobrancas',       requireAuth, cobrancaRoutes);

// ─────────────────────────────────────────────
// Static + SPA (checkout only)
// ─────────────────────────────────────────────
const frontendDist = path.join(__dirname, '../../kore-frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

// PUBLIC: Checkout pages (SPA fallback)
const serveSpa = (_req: any, res: any) => {
  const indexPath = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(503).send('Sistema em manutenção.');
  }
};

app.get('/pagar/:publicId', serveSpa);
app.get('/checkout/:pacote', serveSpa);

// PUBLIC: Root
app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kore Nextus — Pagamentos</title>
  <style>
    body { font-family: sans-serif; background: #0f172a; color: #e2e8f0;
           display: flex; align-items: center; justify-content: center;
           height: 100vh; margin: 0; text-align: center; }
    h1 { font-size: 2rem; margin-bottom: .5rem; }
    p  { color: #94a3b8; }
  </style>
</head>
<body>
  <div>
    <h1>⚡ Kore Nextus</h1>
    <p>Use o link de pagamento que você recebeu.</p>
    <p style="font-size:.8rem;margin-top:2rem;color:#475569">pag.korenextus.com.br</p>
  </div>
</body>
</html>`);
});

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────
async function main() {
  // Start server first so health checks pass, then connect DB
  app.listen(PORT, () => {
    console.log(`🚀 Kore Nextus Backend rodando na porta ${PORT}`);
    console.log(`📊 DATABASE_URL set: ${!!process.env.DATABASE_URL}`);
    console.log(`🔐 JWT_SECRET set: ${!!process.env.SUPABASE_JWT_SECRET}`);
  });

  try {
    await initDatabase();
    console.log('✅ DB conectado com sucesso');
  } catch (err) {
    console.error('⚠️  DB connection failed (server still running):', err);
  }
}

main().catch(err => {
  console.error('❌ Falha ao iniciar:', err);
  process.exit(1);
});

export default app;
