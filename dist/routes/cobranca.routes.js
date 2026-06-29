"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const uuid_1 = require("uuid");
const nanoid_1 = require("nanoid");
const mercadopago_service_1 = require("../services/mercadopago.service");
const telegram_service_1 = require("../services/telegram.service");
const router = (0, express_1.Router)();
const nanoid = (0, nanoid_1.customAlphabet)('23456789abcdefghjkmnpqrstuvwxyz', 10);
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3001';
// ─────────────────────────────────────────────
// GET /api/cobrancas — list all
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;
        let query = `
      SELECT c.*, cl.name as client_name, cl.cpf_cnpj as client_cpf_cnpj, cl.email as client_email
      FROM cobrancas c
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE 1=1
    `;
        const params = [];
        if (status) {
            query += ' AND c.status = ?';
            params.push(status);
        }
        query += ' ORDER BY c.created_at DESC';
        res.json(await database_1.db.prepare(query).all(...params));
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ─────────────────────────────────────────────
// GET /api/cobrancas/public/:public_id — public access (checkout page)
// IMPORTANT: this route must come before /:id
// ─────────────────────────────────────────────
router.get('/public/:public_id', async (req, res) => {
    try {
        const c = await database_1.db.prepare(`
      SELECT c.public_id, c.valor, c.descricao, c.status, c.vencimento,
             c.payment_methods, c.picpay_payment_url, c.picpay_qr_content,
             c.picpay_qr_base64, c.picpay_expires_at, c.paid_at, c.paid_method,
             cl.name as client_name
      FROM cobrancas c
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.public_id = ?
    `).get(req.params.public_id);
        if (!c)
            return res.status(404).json({ error: 'Cobrança não encontrada' });
        const settings = await database_1.db.prepare('SELECT company_name FROM settings WHERE id = 1').get();
        res.json({
            ...c,
            merchant_name: settings?.company_name || 'Kore Nextus',
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ─────────────────────────────────────────────
// GET /api/cobrancas/:id — admin detail
// ─────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const record = await database_1.db.prepare(`
      SELECT c.*, cl.name as client_name, cl.cpf_cnpj as client_cpf_cnpj
      FROM cobrancas c LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.id = ?
    `).get(req.params.id);
        if (!record)
            return res.status(404).json({ error: 'Cobrança não encontrada' });
        res.json(record);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ─────────────────────────────────────────────
// POST /api/cobrancas — create new
// ─────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { client_id, valor, descricao, codigo_servico = '1.07', aliquota_iss = 2.0, vencimento = null, payment_methods = 'pix,card', notes = '', } = req.body;
        if (!client_id || !valor || !descricao) {
            return res.status(400).json({ error: 'Campos obrigatórios: client_id, valor, descricao' });
        }
        const client = await database_1.db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
        if (!client)
            return res.status(404).json({ error: 'Cliente não encontrado' });
        const id = (0, uuid_1.v4)();
        const public_id = nanoid();
        const amount = parseFloat(valor);
        const dueDate = vencimento || null;
        const payer = {
            name: client.name || client.razao_social || 'Cliente',
            email: client.email || '',
            cpfCnpj: client.cpf_cnpj || '',
            tipoPessoa: client.tipo_pessoa === 'F' ? 'F' : 'J',
        };
        const successUrl = PUBLIC_URL.startsWith('https://')
            ? `${PUBLIC_URL.replace(/\/$/, '')}/pagar/${public_id}/sucesso`
            : undefined;
        // 1. Criar pagamento PIX (QR inline)
        let pixQrCode = '';
        let pixQrBase64 = '';
        let pixExpiresAt = '';
        let mpPaymentId = '';
        const methods = payment_methods.split(',');
        if (methods.includes('pix')) {
            try {
                const pix = await (0, mercadopago_service_1.createPixPayment)(amount, descricao, public_id, payer, dueDate);
                mpPaymentId = pix.paymentId;
                pixQrCode = pix.qrCode;
                pixQrBase64 = pix.qrCodeBase64 ? `data:image/png;base64,${pix.qrCodeBase64}` : '';
                pixExpiresAt = pix.expirationDate;
            }
            catch (e) {
                return res.status(500).json({ error: `Erro ao criar PIX no Mercado Pago: ${e.message}` });
            }
        }
        // 2. Criar preference para cartão (Checkout Pro)
        let checkoutUrl = '';
        if (methods.includes('card')) {
            try {
                const pref = await (0, mercadopago_service_1.createPreference)(amount, descricao, public_id, payer.email, dueDate, successUrl);
                checkoutUrl = pref.initPoint;
            }
            catch (e) {
                // Não bloqueia se o PIX já foi criado — só loga o erro
                console.warn('Aviso: erro ao criar preference MP (cartão):', e.message);
            }
        }
        // Fallback: se apenas cartão e sem PIX, usa checkout pro URL
        const paymentUrl = checkoutUrl || pixQrCode;
        // 3. Inserir no banco
        await database_1.db.prepare(`
      INSERT INTO cobrancas (
        id, public_id, client_id, valor, descricao, codigo_servico, aliquota_iss,
        status, vencimento, payment_methods,
        picpay_payment_url, picpay_qr_content, picpay_qr_base64, picpay_expires_at,
        provider, provider_payment_id,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 'mercadopago', ?, ?, NOW(), NOW())
    `).run(id, public_id, client_id, amount, descricao, codigo_servico, parseFloat(aliquota_iss), dueDate, payment_methods, checkoutUrl, pixQrCode, pixQrBase64, pixExpiresAt, mpPaymentId, notes);
        const created = await database_1.db.prepare(`
      SELECT c.*, cl.name as client_name FROM cobrancas c
      LEFT JOIN clients cl ON c.client_id = cl.id WHERE c.id = ?
    `).get(id);
        const publicUrl = `${PUBLIC_URL.replace(/\/$/, '')}/pagar/${public_id}`;
        (0, telegram_service_1.notifyCobrancaCreated)({
            clientName: client.name,
            valor: amount,
            publicUrl,
        }).catch((e) => console.warn('Telegram notify failed:', e.message));
        res.status(201).json({ ...created, public_url: publicUrl });
    }
    catch (error) {
        console.error('Erro criar cobrança:', error);
        res.status(500).json({ error: error.message });
    }
});
// ─────────────────────────────────────────────
// PUT /api/cobrancas/:id — update notes (only if pending)
// ─────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const c = await database_1.db.prepare('SELECT status FROM cobrancas WHERE id = ?').get(req.params.id);
        if (!c)
            return res.status(404).json({ error: 'Cobrança não encontrada' });
        if (c.status !== 'pending')
            return res.status(400).json({ error: 'Apenas cobranças pendentes podem ser editadas' });
        const { notes } = req.body;
        await database_1.db.prepare(`UPDATE cobrancas SET notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?`)
            .run(notes, req.params.id);
        res.json(await database_1.db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(req.params.id));
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ─────────────────────────────────────────────
// POST /public/:public_id/pay-card — checkout transparente (sem auth)
// Recebe o cardFormData do Mercado Pago Bricks e processa o pagamento
// ─────────────────────────────────────────────
router.post('/public/:public_id/pay-card', async (req, res) => {
    try {
        const cobranca = await database_1.db.prepare(`
      SELECT c.*, cl.name as client_name FROM cobrancas c
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.public_id = ?
    `).get(req.params.public_id);
        if (!cobranca)
            return res.status(404).json({ error: 'Cobrança não encontrada' });
        if (cobranca.status !== 'pending')
            return res.status(400).json({ error: 'Cobrança não está pendente' });
        const payment = await (0, mercadopago_service_1.createCardPayment)(cobranca.valor, cobranca.descricao, cobranca.public_id, req.body);
        if (payment.status === 'approved' || payment.status === 'authorized') {
            const methodLabel = (0, mercadopago_service_1.mpMethodLabel)(payment.payment_type_id || 'credit_card');
            const today = new Date().toISOString().split('T')[0];
            const settings = await database_1.db.prepare('SELECT * FROM settings WHERE id = 1').get();
            const taxPercent = settings?.tax_reserve_percent || 6.0;
            const taxAmount = +(cobranca.valor * (taxPercent / 100)).toFixed(2);
            await database_1.db.prepare(`UPDATE cobrancas SET status = 'paid', paid_at = NOW(), paid_method = ?, authorization_id = ?, updated_at = NOW() WHERE id = ?`)
                .run(methodLabel, String(payment.id), cobranca.id);
            const txId = (0, uuid_1.v4)();
            await database_1.db.prepare(`
        INSERT INTO transactions (id, type, description, amount, date, category, status, client_id, notes, tax_reserve_amount)
        VALUES (?, 'income', ?, ?, ?, 'Cobrança Mercado Pago', 'completed', ?, ?, ?)
      `).run(txId, `Pagamento — ${cobranca.descricao.substring(0, 80)}`, cobranca.valor, today, cobranca.client_id, `Cobrança ${cobranca.public_id} via MP (${methodLabel})`, taxAmount);
            await database_1.db.prepare(`INSERT INTO tax_reserves (id, transaction_id, amount, percent, reference_month, status) VALUES (?, ?, ?, ?, ?, 'pending')`)
                .run((0, uuid_1.v4)(), txId, taxAmount, taxPercent, today.substring(0, 7));
            await database_1.db.prepare('UPDATE cobrancas SET transaction_id = ? WHERE id = ?').run(txId, cobranca.id);
            return res.json({ success: true });
        }
        if (payment.status === 'pending' || payment.status === 'in_process') {
            return res.json({ success: false, pending: true, message: 'Pagamento em análise. Você receberá confirmação em breve.' });
        }
        // rejected — mapear status_detail para mensagem amigável
        const detail = payment.status_detail || '';
        const friendlyErrors = {
            cc_rejected_insufficient_amount: 'Saldo insuficiente no cartão.',
            cc_rejected_bad_filled_card_number: 'Número do cartão incorreto.',
            cc_rejected_bad_filled_date: 'Data de validade incorreta.',
            cc_rejected_bad_filled_security_code: 'Código de segurança incorreto.',
            cc_rejected_call_for_authorize: 'Autorize o pagamento com seu banco e tente novamente.',
            cc_rejected_card_disabled: 'Cartão desabilitado. Entre em contato com seu banco.',
            cc_rejected_duplicated_payment: 'Pagamento duplicado detectado.',
            cc_rejected_high_risk: 'Pagamento recusado por segurança.',
        };
        res.json({
            success: false,
            error: friendlyErrors[detail] || 'Pagamento não aprovado. Verifique os dados e tente novamente.',
        });
    }
    catch (error) {
        console.error('Erro processar cartão:', error);
        res.status(500).json({ error: error.message });
    }
});
// ─────────────────────────────────────────────
// POST /api/cobrancas/:id/cancel
// ─────────────────────────────────────────────
router.post('/:id/cancel', async (req, res) => {
    try {
        const c = await database_1.db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(req.params.id);
        if (!c)
            return res.status(404).json({ error: 'Cobrança não encontrada' });
        if (c.provider_payment_id) {
            await (0, mercadopago_service_1.cancelPixPayment)(c.provider_payment_id).catch(() => { });
        }
        await database_1.db.prepare(`UPDATE cobrancas SET status = 'cancelled', updated_at = NOW() WHERE id = ?`)
            .run(req.params.id);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=cobranca.routes.js.map