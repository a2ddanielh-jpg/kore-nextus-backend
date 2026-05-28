import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { parseWebhook } from '../services/asaas.service';
import { notifyPaymentReceived, notifyNfseEmitted, notifyError, sendMessage } from '../services/telegram.service';

const router = Router();

// ─────────────────────────────────────────────
// POST /api/webhooks/asaas
// ─────────────────────────────────────────────
router.post('/asaas', async (req: Request, res: Response) => {
  // ALWAYS respond 200 quickly — Asaas retries on non-2xx
  res.status(200).json({ received: true });

  try {
    const payload = parseWebhook(req.body);
    if (!payload) {
      console.warn('Webhook Asaas: payload inválido', req.body);
      return;
    }

    const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
    if (expectedToken) {
      const received = req.headers['asaas-access-token'];
      if (received !== expectedToken) {
        console.warn('Webhook Asaas: token inválido');
        return;
      }
    }

    console.log(`📨 Webhook Asaas: ${payload.event}`);

    switch (payload.event) {
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_CONFIRMED':
        await handlePaymentReceived(payload.payment);
        break;

      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_DELETED':
        await handlePaymentCancelled(payload.payment);
        break;

      case 'PAYMENT_OVERDUE':
        await handlePaymentOverdue(payload.payment);
        break;

      case 'INVOICE_AUTHORIZED':
        await handleInvoiceAuthorized(payload.invoice);
        break;

      case 'INVOICE_ERROR':
        await handleInvoiceError(payload.invoice);
        break;

      case 'INVOICE_CANCELED':
        await handleInvoiceCancelled(payload.invoice);
        break;

      default:
        break;
    }
  } catch (e: any) {
    console.error('Erro processar webhook Asaas:', e);
    notifyError('Webhook Asaas', e.message).catch(() => {});
  }
});

// ─────────────────────────────────────────────
// PAYMENT_RECEIVED
// ─────────────────────────────────────────────
async function handlePaymentReceived(payment: any): Promise<void> {
  if (!payment?.externalReference) {
    console.warn('Payment sem externalReference, ignorando');
    return;
  }

  const cobranca = await db.prepare(`
    SELECT c.*, cl.name as client_name, cl.cpf_cnpj as client_cpf_cnpj
    FROM cobrancas c LEFT JOIN clients cl ON c.client_id = cl.id
    WHERE c.public_id = ?
  `).get(payment.externalReference) as any;

  if (!cobranca) {
    console.warn(`Cobrança não encontrada para externalReference=${payment.externalReference}`);
    return;
  }

  if (cobranca.status === 'paid') {
    console.log(`Cobrança ${payment.externalReference} já estava paga.`);
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const billingType = payment.billingType || 'PIX';

  // 1. Marcar como paga
  await db.prepare(`
    UPDATE cobrancas SET
      status = 'paid', paid_at = NOW(), paid_method = ?, authorization_id = ?, updated_at = NOW()
    WHERE id = ?
  `).run(billingType, payment.id, cobranca.id);

  // 2. Criar entrada financeira
  const settings = await db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const taxPercent = settings?.tax_reserve_percent || 6.0;
  const taxAmount = +(cobranca.valor * (taxPercent / 100)).toFixed(2);

  const txId = uuidv4();
  await db.prepare(`
    INSERT INTO transactions (
      id, type, description, amount, date, category, status,
      client_id, notes, tax_reserve_amount
    ) VALUES (?, 'income', ?, ?, ?, 'Cobrança Asaas', 'completed', ?, ?, ?)
  `).run(
    txId,
    `Pagamento — ${cobranca.descricao.substring(0, 80)}`,
    cobranca.valor, today, cobranca.client_id,
    `Cobrança ${cobranca.public_id} via Asaas (${billingType})`,
    taxAmount
  );

  // 3. Reserva de impostos
  await db.prepare(`
    INSERT INTO tax_reserves (id, transaction_id, amount, percent, reference_month, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(uuidv4(), txId, taxAmount, taxPercent, today.substring(0, 7));

  // 4. Link transaction → cobrança
  await db.prepare('UPDATE cobrancas SET transaction_id = ? WHERE id = ?').run(txId, cobranca.id);

  // 5. Telegram notification
  await notifyPaymentReceived({
    clientName: cobranca.client_name,
    valor: cobranca.valor,
    descricao: cobranca.descricao,
    cobrancaId: cobranca.public_id,
    method: billingType === 'PIX' ? 'PIX' : billingType === 'CREDIT_CARD' ? 'Cartão' : billingType,
  });

  console.log(`✅ Pagamento processado — ${cobranca.public_id} | ${cobranca.client_name} | R$ ${cobranca.valor}`);
}

// ─────────────────────────────────────────────
// INVOICE_AUTHORIZED — NFS-e emitida com sucesso
// ─────────────────────────────────────────────
async function handleInvoiceAuthorized(invoice: any): Promise<void> {
  if (!invoice?.payment) return;

  const cobranca = await db.prepare(`
    SELECT c.*, cl.name as client_name FROM cobrancas c
    LEFT JOIN clients cl ON c.client_id = cl.id
    WHERE c.provider_payment_id = ?
  `).get(invoice.payment) as any;

  if (!cobranca) {
    console.warn(`Cobrança não encontrada para payment ID ${invoice.payment}`);
    return;
  }

  await db.prepare(`
    UPDATE cobrancas SET
      provider_invoice_id = ?, nfse_numero = ?, updated_at = NOW()
    WHERE id = ?
  `).run(invoice.id, invoice.number || '', cobranca.id);

  await notifyNfseEmitted({
    numero: invoice.number || invoice.id,
    clientName: cobranca.client_name,
    valor: cobranca.valor,
  });

  console.log(`📋 NFS-e ${invoice.number} emitida — ${cobranca.client_name}`);
}

// ─────────────────────────────────────────────
// INVOICE_ERROR
// ─────────────────────────────────────────────
async function handleInvoiceError(invoice: any): Promise<void> {
  const errMsg = invoice?.observations || invoice?.error || 'erro desconhecido';
  await sendMessage(
    `⚠️ *Erro na emissão da NFS-e*\n\n` +
    `Pagamento: \`${invoice?.payment || '?'}\`\n` +
    `Erro: ${errMsg}\n\n` +
    `Verifique a configuração em Asaas → Notas Fiscais.`
  );
  console.warn(`NFS-e ERROR para payment ${invoice?.payment}: ${errMsg}`);
}

// ─────────────────────────────────────────────
// INVOICE_CANCELED
// ─────────────────────────────────────────────
async function handleInvoiceCancelled(invoice: any): Promise<void> {
  console.log(`📋 NFS-e cancelada: ${invoice?.id}`);
  await sendMessage(`📋 NFS-e cancelada: \`${invoice?.id || '?'}\``);
}

// ─────────────────────────────────────────────
// PAYMENT_REFUNDED / PAYMENT_DELETED
// ─────────────────────────────────────────────
async function handlePaymentCancelled(payment: any): Promise<void> {
  if (!payment?.externalReference) return;

  await db.prepare(`UPDATE cobrancas SET status = 'cancelled', updated_at = NOW() WHERE public_id = ?`)
    .run(payment.externalReference);

  await sendMessage(`↩️ Pagamento estornado/cancelado: cobrança \`${payment.externalReference}\``);
}

// ─────────────────────────────────────────────
// PAYMENT_OVERDUE
// ─────────────────────────────────────────────
async function handlePaymentOverdue(payment: any): Promise<void> {
  if (!payment?.externalReference) return;

  await db.prepare(`UPDATE cobrancas SET status = 'expired', updated_at = NOW() WHERE public_id = ?`)
    .run(payment.externalReference);

  await sendMessage(`⏰ Cobrança vencida: \`${payment.externalReference}\``);
}

// Health
router.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

export default router;
