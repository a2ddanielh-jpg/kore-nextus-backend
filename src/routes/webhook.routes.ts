import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { getPayment, verifyWebhookSignature, mpMethodLabel } from '../services/mercadopago.service';
import { notifyPaymentReceived, notifyNfseEmitted, notifyError, sendMessage } from '../services/telegram.service';

const router = Router();

// ─────────────────────────────────────────────
// POST /api/webhooks/mercadopago
// MP envia: { "action": "payment.updated", "data": { "id": "12345" } }
// ─────────────────────────────────────────────
router.post('/mercadopago', async (req: Request, res: Response) => {
  // Responder 200 imediatamente — MP retenta em caso de falha
  res.status(200).json({ received: true });

  try {
    const body = req.body || {};

    // Suporte a IPN (query params) e webhooks (body JSON)
    const paymentId: string =
      (req.query.id as string) ||
      body?.data?.id ||
      body?.id;

    const topic: string =
      (req.query.topic as string) ||
      body?.type ||
      body?.action?.split('.')?.[0];

    if (!paymentId || (topic && topic !== 'payment' && topic !== 'payment.updated' && !topic.startsWith('payment'))) {
      return;
    }

    // Verificação de assinatura (opcional)
    const xSig = req.headers['x-signature'] as string | undefined;
    const xReqId = req.headers['x-request-id'] as string | undefined;
    if (!verifyWebhookSignature(xSig, xReqId, paymentId)) {
      console.warn('Webhook MP: assinatura inválida');
      return;
    }

    console.log(`📨 Webhook Mercado Pago: payment ${paymentId}`);

    // Buscar status atual do pagamento na API do MP
    const payment = await getPayment(paymentId);
    if (!payment) return;

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
  } catch (e: any) {
    console.error('Erro processar webhook Mercado Pago:', e);
    notifyError('Webhook Mercado Pago', e.message).catch(() => {});
  }
});

// ─────────────────────────────────────────────
// PAYMENT APPROVED
// ─────────────────────────────────────────────
async function handlePaymentApproved(payment: any): Promise<void> {
  const externalRef: string = payment.external_reference;

  if (!externalRef) {
    console.warn('Webhook MP: pagamento sem external_reference, ignorando');
    return;
  }

  const cobranca = await db.prepare(`
    SELECT c.*, cl.name as client_name, cl.cpf_cnpj as client_cpf_cnpj
    FROM cobrancas c LEFT JOIN clients cl ON c.client_id = cl.id
    WHERE c.public_id = ?
  `).get(externalRef) as any;

  if (!cobranca) {
    console.warn(`Webhook MP: cobrança não encontrada para external_reference=${externalRef}`);
    return;
  }

  if (cobranca.status === 'paid') {
    console.log(`Cobrança ${externalRef} já estava paga.`);
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const methodLabel = mpMethodLabel(payment.payment_type_id || payment.payment_method_id || '');

  // 1. Marcar como paga
  await db.prepare(`
    UPDATE cobrancas SET
      status = 'paid', paid_at = NOW(), paid_method = ?, authorization_id = ?, updated_at = NOW()
    WHERE id = ?
  `).run(methodLabel, String(payment.id), cobranca.id);

  // 2. Criar entrada financeira
  const settings = await db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const taxPercent = settings?.tax_reserve_percent || 6.0;
  const taxAmount = +(cobranca.valor * (taxPercent / 100)).toFixed(2);

  const txId = uuidv4();
  await db.prepare(`
    INSERT INTO transactions (
      id, type, description, amount, date, category, status,
      client_id, notes, tax_reserve_amount
    ) VALUES (?, 'income', ?, ?, ?, 'Cobrança Mercado Pago', 'completed', ?, ?, ?)
  `).run(
    txId,
    `Pagamento — ${cobranca.descricao.substring(0, 80)}`,
    cobranca.valor, today, cobranca.client_id,
    `Cobrança ${cobranca.public_id} via Mercado Pago (${methodLabel})`,
    taxAmount,
  );

  // 3. Reserva de impostos
  await db.prepare(`
    INSERT INTO tax_reserves (id, transaction_id, amount, percent, reference_month, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(uuidv4(), txId, taxAmount, taxPercent, today.substring(0, 7));

  // 4. Link transaction → cobrança
  await db.prepare('UPDATE cobrancas SET transaction_id = ? WHERE id = ?').run(txId, cobranca.id);

  // 5. Notificação Telegram
  await notifyPaymentReceived({
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
async function handlePaymentCancelled(payment: any): Promise<void> {
  const externalRef: string = payment.external_reference;
  if (!externalRef) return;

  await db.prepare(`UPDATE cobrancas SET status = 'cancelled', updated_at = NOW() WHERE public_id = ?`)
    .run(externalRef);

  await sendMessage(`↩️ Pagamento estornado/cancelado: cobrança \`${externalRef}\` (MP id: ${payment.id})`);
}

// Health
router.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

export default router;
