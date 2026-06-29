"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const database_1 = require("./db/database");
const auth_1 = require("./middleware/auth");
const dashboard_routes_1 = __importDefault(require("./routes/dashboard.routes"));
const transaction_routes_1 = __importDefault(require("./routes/transaction.routes"));
const fixedExpense_routes_1 = __importDefault(require("./routes/fixedExpense.routes"));
const taxReserve_routes_1 = __importDefault(require("./routes/taxReserve.routes"));
const nfse_routes_1 = __importDefault(require("./routes/nfse.routes"));
const client_routes_1 = __importDefault(require("./routes/client.routes"));
const settings_routes_1 = __importDefault(require("./routes/settings.routes"));
const cobranca_routes_1 = __importDefault(require("./routes/cobranca.routes"));
const pacote_routes_1 = __importDefault(require("./routes/pacote.routes"));
const webhook_routes_1 = __importDefault(require("./routes/webhook.routes"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// CORS
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'https://gestion.korenextus.com',
    'http://localhost:5173',
    'http://localhost:3000',
];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, webhooks)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin))
            return callback(null, true);
        callback(null, true); // permissive for now — lock down after deploy confirmed
    },
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Serve uploaded certificates
app.use('/certificates', express_1.default.static(path_1.default.join(__dirname, '../certificates')));
// ─────────────────────────────────────────────
// PUBLIC routes — no auth required
// ─────────────────────────────────────────────
// Mercado Pago webhook — must be public (MP calls this)
app.use('/api/webhooks', webhook_routes_1.default);
// Public checkout data (used by the checkout React page)
app.get('/api/cobrancas/public/:public_id', (req, res, next) => {
    req.url = `/public/${req.params.public_id}`;
    (0, cobranca_routes_1.default)(req, res, next);
});
// Public card payment — Mercado Pago Bricks posts token here (no auth required)
app.post('/api/cobrancas/public/:public_id/pay-card', (req, res, next) => {
    req.url = `/public/${req.params.public_id}/pay-card`;
    (0, cobranca_routes_1.default)(req, res, next);
});
// Package checkout — public (called from landing page)
app.use('/api/pacotes', pacote_routes_1.default);
// Health check — public
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});
// ─────────────────────────────────────────────
// PROTECTED routes — require valid Supabase JWT
// ─────────────────────────────────────────────
app.use('/api/dashboard', auth_1.requireAuth, dashboard_routes_1.default);
app.use('/api/transactions', auth_1.requireAuth, transaction_routes_1.default);
app.use('/api/fixed-expenses', auth_1.requireAuth, fixedExpense_routes_1.default);
app.use('/api/tax-reserve', auth_1.requireAuth, taxReserve_routes_1.default);
app.use('/api/nfse', auth_1.requireAuth, nfse_routes_1.default);
app.use('/api/clients', auth_1.requireAuth, client_routes_1.default);
app.use('/api/settings', auth_1.requireAuth, settings_routes_1.default);
app.use('/api/cobrancas', auth_1.requireAuth, cobranca_routes_1.default);
// ─────────────────────────────────────────────
// Static + SPA (checkout only)
// ─────────────────────────────────────────────
const frontendDist = path_1.default.join(__dirname, '../../kore-frontend/dist');
if (fs_1.default.existsSync(frontendDist)) {
    app.use(express_1.default.static(frontendDist));
}
// PUBLIC: Checkout pages (SPA fallback)
const serveSpa = (_req, res) => {
    const indexPath = path_1.default.join(frontendDist, 'index.html');
    if (fs_1.default.existsSync(indexPath)) {
        res.sendFile(indexPath);
    }
    else {
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
    await (0, database_1.initDatabase)();
    app.listen(PORT, () => {
        console.log(`🚀 Kore Nextus Backend rodando na porta ${PORT}`);
        console.log(`📊 API disponível em http://localhost:${PORT}/api`);
        console.log(`🌐 Public URL: ${process.env.PUBLIC_URL || 'http://localhost:3001'}`);
        console.log(`🔐 Auth: Supabase JWT`);
    });
}
main().catch(err => {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
});
exports.default = app;
//# sourceMappingURL=index.js.map