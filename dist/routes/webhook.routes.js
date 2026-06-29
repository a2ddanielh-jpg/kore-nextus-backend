"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const uuid_1 = require("uuid");
const mercadopago_service_1 = require("../services/mercadopago.service");
const telegram_service_1 = require("../services/telegram.service");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// POST /api/webhooks/mercadopago
// MP envia: { "action": "payment.updated", "data": { "id": "12345" } }
// ─────────────────────────────────────────────
router.post('/mercadopago', async (req, res) => {
    // Responder 200 imediatamente — MP retenta em caso de falha
    res.status(200).json({ received: true });
    try {
        const body = req.body || {};
        // Suporte a IPN (query params) e webhooks (body JSON)
        const paymentId = req.query.id ||
            body?.data?.id ||
            body?.id;
        const topic = req.query.topic ||
            body?.type ||
            body?.action?.split('.')?.[0];
        if (!paymentId || (topic && topic !== 'payment' && topic !== 'payment.updated' && !topic.startsWith('payment'))) {
            return;
        }
        // Verificação de assinatura (opcional)
        const xSig = req.headers['x-signature'];
        const xReqId = req.headers['x-request-id'];
        if (!(0, mercadopago_service_1.verifyWebhookSignature)(xSig, xReqId, paymentId)) {
            console.warn('Webhook MP: assinatura inválida');
            return;
        }
        console.log(`📨 Webhook Mercado Pago: payment ${paymentId}`);
        // Buscar status atual do pagamento na API do MP
        const payment = await (0, mercadopago_service_1.getPayment)(paymentId);
        if (!payment)
            return;
        switch (payment.status) {
            case 'approved':
                await handlePaymentApproved(payment);
                break;
            case 'cancelled':
            case 'refunded':
            case 'charged_back':
                await handlePaymentCancelled(payment);
                break;
            case 'pending':
            case 'in_process':
            case 'authorized':
                // Aguardando — sem ação necessária
                break;
            case 'rejected':
                console.log(`❌ Pagamento rejeitado: ${paymentId} — ${payment.status_detail}`);
                break;
            default:
                console.log(`Webhook MP status desconhecido: ${payment.status}`);
        }
    }
    catch (e) {
        console.error('Erro processar webhook Mercado Pago:', e);
        (0, telegram_service_1.notifyError)('Webhook Mercado Pago', e.message).catch(() => { });
    }
});
// ─────────────────────────────────────────────
// PAYMENT APPROVED
// ─────────────────────────────────────────────
async function handlePaymentApproved(payment) {
    const externalRef = payment.external_reference;
    if (!externalRef) {
        console.warn('Webhook MP: pagamento sem external_reference, ignorando');
        return;
    }
    const cobranca = await database_1.db.prepare(`
    SELECT c.*, cl.name as client_name, cl.cpf_cnpj as client_cpf_cnpj
    FROM cobrancas c LEFT JOIN clients cl ON c.client_id = cl.id
    WHERE c.public_id = ?
  `).get(externalRef);
    if (!cobranca) {
        console.warn(`Webhook MP: cobrança não encontrada para external_reference=${externalRef}`);
        return;
    }
    if (cobranca.status === 'paid') {
        console.log(`Cobrança ${externalRef} já estava paga.`);
        return;
    }
    const today = new Date().toISOString().split('T')[0];
    const methodLabel = (0, mercadopago_service_1.mpMethodLabel)(payment.payment_type_id || payment.payment_method_id || '');
    // 1. Marcar como paga
    await database_1.db.prepare(`
    UPDATE cobrancas SET
      status = 'paid', paid_at = NOW(), paid_method = ?, authorization_id = ?, updated_at = NOW()
    WHERE id = ?
  `).run(methodLabel, String(payment.id), cobranca.id);
    // 2. Criar entrada financeira
    const settings = await database_1.db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const taxPercent = settings?.tax_reserve_percent || 6.0;
    const taxAmount = +(cobranca.valor * (taxPercent / 100)).toFixed(2);
    const txId = (0, uuid_1.v4)();
    await database_1.db.prepare(`
    INSERT INTO transactions (
      id, type, description, amount, date, category, status,
      client_id, notes, tax_reserve_amount
    ) VALUES (?, 'income', ?, ?, ?, 'Cobrança Mercado Pago', 'completed', ?, ?, ?)
  `).run(txId, `Pagamento — ${cobranca.descricao.substring(0, 80)}`, cobranca.valor, today, cobranca.client_id, `Cobrança ${cobranca.public_id} via Mercado Pago (${methodLabel})`, taxAmount);
    // 3. Reserva de impostos
    await database_1.db.prepare(`
    INSERT INTO tax_reserves (id, transaction_id, amount, percent, reference_month, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run((0, uuid_1.v4)(), txId, taxAmount, taxPercent, today.substring(0, 7));
    // 4. Link transaction → cobrança
    await database_1.db.prepare('UPDATE cobrancas SET transaction_id = ? WHERE id = ?').run(txId, cobranca.id);
    // 5. Notificação Telegram
    await (0, telegram_service_1.notifyPaymentReceived)({
        clientName: cobranca.client_name,
        valor: cobranca.valor,
        descricao: cobranca.descricao,
        cobrancaId: cobranca.public_id,
        method: methodLabel,
    });
    console.log(`✅ Pagamento aprovado — ${cobranca.public_id} | ${cobranca.client_name} | R$ ${cobranca.valor}`);
}
// ─────────────────────────────────────────────
// PAYMENT CANCELLED / REFUNDED
// ─────────────────────────────────────────────
async function handlePaymentCancelled(payment) {
    const externalRef = payment.external_reference;
    if (!externalRef)
        return;
    await database_1.db.prepare(`UPDATE cobrancas SET status = 'cancelled', updated_at = NOW() WHERE public_id = ?`)
        .run(externalRef);
    await (0, telegram_service_1.sendMessage)(`↩️ Pagamento estornado/cancelado: cobrança \`${externalRef}\` (MP id: ${payment.id})`);
}
// Health
router.get('/health', (_req, res) => res.json({ ok: true }));
exports.default = router;
//# sourceMappingURL=webhook.routes.js.map