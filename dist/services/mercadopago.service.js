"use strict";
// ============================================================
// Mercado Pago Gateway — PIX + Checkout Pro (cartão)
// Docs: https://www.mercadopago.com.br/developers/pt/docs
// Auth: Bearer token no header Authorization
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPixPayment = createPixPayment;
exports.createPreference = createPreference;
exports.getPayment = getPayment;
exports.cancelPixPayment = cancelPixPayment;
exports.verifyWebhookSignature = verifyWebhookSignature;
exports.createCardPayment = createCardPayment;
exports.mpMethodLabel = mpMethodLabel;
const API_URL = 'https://api.mercadopago.com';
const ACCESS_TOKEN = () => process.env.MP_ACCESS_TOKEN || '';
function authHeaders(idempotencyKey) {
    const token = ACCESS_TOKEN();
    if (!token)
        throw new Error('MP_ACCESS_TOKEN não configurada no .env');
    const h = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
    if (idempotencyKey)
        h['X-Idempotency-Key'] = idempotencyKey;
    return h;
}
async function call(path, method, body, idempotencyKey) {
    const response = await fetch(`${API_URL}${path}`, {
        method,
        headers: authHeaders(idempotencyKey),
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = {};
    try {
        data = JSON.parse(text);
    }
    catch {
        data = { raw: text };
    }
    if (!response.ok) {
        const msg = data.message || data.error || `HTTP ${response.status}`;
        throw new Error(`MP ${method} ${path} → ${msg}`);
    }
    return data;
}
// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function splitName(fullName) {
    const parts = (fullName || 'Cliente').trim().split(/\s+/);
    const first_name = parts[0] || 'Cliente';
    const last_name = parts.slice(1).join(' ') || 'Pagador';
    return { first_name, last_name };
}
function isoExpiration(vencimento) {
    const date = vencimento ? new Date(`${vencimento}T23:59:59`) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    // Format as ISO with -03:00 offset (Brazil)
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T23:59:59.000-03:00`;
}
async function createPixPayment(amount, description, externalReference, payer, vencimento) {
    const { first_name, last_name } = splitName(payer.name);
    const body = {
        transaction_amount: amount,
        description: description.substring(0, 250),
        payment_method_id: 'pix',
        external_reference: externalReference,
        date_of_expiration: isoExpiration(vencimento),
        payer: {
            email: payer.email || `pagador+${externalReference}@korenextus.com.br`,
            first_name,
            last_name,
            identification: {
                type: payer.tipoPessoa === 'F' ? 'CPF' : 'CNPJ',
                number: payer.cpfCnpj.replace(/\D/g, ''),
            },
        },
    };
    const data = await call('/v1/payments', 'POST', body, externalReference);
    const txData = data.point_of_interaction?.transaction_data || {};
    return {
        paymentId: String(data.id),
        qrCode: txData.qr_code || '',
        qrCodeBase64: txData.qr_code_base64 || '',
        ticketUrl: txData.ticket_url || '',
        expirationDate: data.date_of_expiration || isoExpiration(vencimento),
    };
}
async function createPreference(amount, description, externalReference, payerEmail, vencimento, successUrl) {
    const body = {
        items: [{
                title: description.substring(0, 250),
                quantity: 1,
                unit_price: amount,
                currency_id: 'BRL',
            }],
        payer: { email: payerEmail || `pagador+${externalReference}@korenextus.com.br` },
        external_reference: externalReference,
        expires: true,
        expiration_date_to: isoExpiration(vencimento),
        payment_methods: {
            excluded_payment_methods: [],
            excluded_payment_types: [{ id: 'ticket' }], // sem boleto
            installments: 12,
        },
    };
    if (successUrl) {
        body.back_urls = { success: successUrl, pending: successUrl, failure: successUrl };
        body.auto_return = 'approved';
    }
    const data = await call('/checkout/preferences', 'POST', body, `pref-${externalReference}`);
    return {
        preferenceId: data.id || '',
        initPoint: data.init_point || '',
        sandboxInitPoint: data.sandbox_init_point || '',
    };
}
// ─────────────────────────────────────────────
// Get payment (usado no webhook)
// ─────────────────────────────────────────────
async function getPayment(paymentId) {
    return await call(`/v1/payments/${paymentId}`, 'GET');
}
// ─────────────────────────────────────────────
// Cancel PIX payment
// ─────────────────────────────────────────────
async function cancelPixPayment(paymentId) {
    try {
        await call(`/v1/payments/${paymentId}`, 'PUT', { status: 'cancelled' });
        return true;
    }
    catch {
        return false;
    }
}
// ─────────────────────────────────────────────
// Webhook signature verification (opcional)
// Verifica o header x-signature enviado pelo MP
// ─────────────────────────────────────────────
function verifyWebhookSignature(xSignature, xRequestId, dataId) {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret)
        return true; // sem secret configurado → aceita tudo
    if (!xSignature)
        return false;
    // MP format: "ts=<timestamp>,v1=<hash>"
    const parts = {};
    xSignature.split(',').forEach(p => {
        const [k, v] = p.split('=');
        if (k && v)
            parts[k.trim()] = v.trim();
    });
    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1)
        return false;
    const crypto = require('crypto');
    const manifest = `id:${dataId || ''};request-id:${xRequestId || ''};ts:${ts};`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return expected === v1;
}
// ─────────────────────────────────────────────
// Card payment — processa token do Checkout Bricks
// ─────────────────────────────────────────────
async function createCardPayment(amount, description, externalReference, cardFormData) {
    const body = {
        transaction_amount: amount,
        token: cardFormData.token,
        description: description.substring(0, 250),
        installments: Number(cardFormData.installments) || 1,
        payment_method_id: cardFormData.payment_method_id,
        external_reference: externalReference,
        payer: cardFormData.payer,
        statement_descriptor: 'KORE NEXTUS',
    };
    if (cardFormData.issuer_id) {
        body.issuer_id = Number(cardFormData.issuer_id);
    }
    return await call('/v1/payments', 'POST', body, `card-${externalReference}-${Date.now()}`);
}
// ─────────────────────────────────────────────
// Map MP payment_type_id → label legível
// ─────────────────────────────────────────────
function mpMethodLabel(paymentTypeId) {
    const map = {
        pix: 'PIX',
        credit_card: 'Cartão de Crédito',
        debit_card: 'Cartão de Débito',
        ticket: 'Boleto',
        bank_transfer: 'Transferência',
    };
    return map[paymentTypeId] || paymentTypeId || 'Mercado Pago';
}
//# sourceMappingURL=mercadopago.service.js.map