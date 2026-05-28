import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { customAlphabet } from 'nanoid';
import {
  getOrCreateCustomer,
  createPayment,
  cancelPayment as cancelAsaasPayment,
  getPixQrCode,
} from '../services/asaas.service';
import { notifyCobrancaCreated } from '../services/telegram.service';

const router = Router();

const nanoid = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 10);

const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3001';

// ─────────────────────────────────────────────
// GET /api/cobrancas — list all
// ─────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT c.*, cl.name as client_name, cl.cpf_cnpj as client_cpf_cnpj, cl.email as client_email
      FROM cobrancas c
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (status) { query += ' AND c.status = ?'; params.push(status); }
    query += ' ORDER BY c.created_at DESC';
    res.json(await db.prepare(query).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/cobrancas/public/:public_id — public access (checkout page)
// IMPORTANT: this route must come before /:id
// ─────────────────────────────────────────────
router.get('/public/:public_id', async (req: Request, res: Response) => {
  try {
    const c = await db.prepare(`
      SELECT c.public_id, c.valor, c.descricao, c.status, c.vencimento,
             c.payment_methods, c.picpay_payment_url, c.picpay_qr_content,
             c.picpay_qr_base64, c.picpay_expires_at, c.paid_at, c.paid_method,
             cl.name as client_name
      FROM cobrancas c
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.public_id = ?
    `).get(req.params.public_id) as any;

    if (!c) return res.status(404).json({ error: 'Cobrança não encontrada' });

    const settings = await db.prepare('SELECT company_name FROM settings WHERE id = 1').get() as any;

    res.json({
      ...c,
      merchant_name: settings?.company_name || 'Kore Nextus',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/cobrancas/:id — admin detail
// ─────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const record = await db.prepare(`
      SELECT c.*, cl.name as client_name, cl.cpf_cnpj as client_cpf_cnpj
      FROM cobrancas c LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Cobrança não encontrada' });
    res.json(record);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/cobrancas — create new
// ─────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      client_id, valor, descricao,
      codigo_servico = '1.07',
      aliquota_iss = 2.0,
      vencimento = null,
      payment_methods = 'pix,card',
      notes = '',
    } = req.body;

    if (!client_id || !valor || !descricao) {
      return res.status(400).json({ error: 'Campos obrigatórios: client_id, valor, descricao' });
    }

    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id) as any;
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    const id = uuidv4();
    const public_id = nanoid();

    const dueDate = vencimento || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 1. Get or create Asaas customer
    let asaasCustomerId: string;
    try {
      asaasCustomerId = await getOrCreateCustomer({
        name: client.name || client.razao_social,
        cpfCnpj: client.cpf_cnpj,
        email: client.email || undefined,
        phone: client.telefone || undefined,
        mobilePhone: client.telefone || undefined,
        postalCode: client.cep || undefined,
        address: client.endereco || undefined,
        addressNumber: client.numero || undefined,
        province: client.bairro || undefined,
      });

      if (client.asaas_customer_id !== asaasCustomerId) {
        await db.prepare('UPDATE clients SET asaas_customer_id = ? WHERE id = ?').run(asaasCustomerId, client_id);
      }
    } catch (e: any) {
      return res.status(500).json({ error: `Erro ao criar customer no Asaas: ${e.message}` });
    }

    // 2. Create payment
    const callbackPublicUrl = PUBLIC_URL.startsWith('https://')
      ? { successUrl: `${PUBLIC_URL.replace(/\/$/, '')}/pagar/${public_id}/sucesso`, autoRedirect: true }
      : undefined;

    let payment: any;
    try {
      payment = await createPayment({
        customerId: asaasCustomerId,
        value: parseFloat(valor),
        dueDate,
        description: descricao,
        externalReference: public_id,
        billingType: 'UNDEFINED',
        callback: callbackPublicUrl,
      });
    } catch (e: any) {
      return res.status(500).json({ error: `Erro ao criar pagamento Asaas: ${e.message}` });
    }

    // 3. Fetch PIX QR code (best effort)
    let pixContent = '';
    let pixBase64 = '';
    let expiresAt = '';
    try {
      const qr = await getPixQrCode(payment.id);
      if (qr) {
        pixContent = qr.payload;
        pixBase64 = qr.encodedImage ? `data:image/png;base64,${qr.encodedImage}` : '';
        expiresAt = qr.expirationDate;
      }
    } catch (e: any) {
      console.warn('PIX QR fetch falhou:', e.message);
    }

    // 4. Insert in DB
    await db.prepare(`
      INSERT INTO cobrancas (
        id, public_id, client_id, valor, descricao, codigo_servico, aliquota_iss,
        status, vencimento, payment_methods,
        picpay_payment_url, picpay_qr_content, picpay_qr_base64, picpay_expires_at,
        provider, provider_payment_id,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 'asaas', ?, ?, NOW(), NOW())
    `).run(
      id, public_id, client_id, parseFloat(valor), descricao, codigo_servico, parseFloat(aliquota_iss),
      vencimento, payment_methods,
      payment.invoiceUrl, pixContent, pixBase64, expiresAt,
      payment.id,
      notes
    );

    const created = await db.prepare(`
      SELECT c.*, cl.name as client_name FROM cobrancas c
      LEFT JOIN clients cl ON c.client_id = cl.id WHERE c.id = ?
    `).get(id) as any;

    const publicUrl = `${PUBLIC_URL.replace(/\/$/, '')}/pagar/${public_id}`;

    notifyCobrancaCreated({
      clientName: client.name,
      valor: parseFloat(valor),
      publicUrl,
    }).catch((e: any) => console.warn('Telegram notify failed:', e.message));

    res.status(201).json({ ...created, public_url: publicUrl });
  } catch (error: any) {
    console.error('Erro criar cobrança:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/cobrancas/:id — update notes (only if pending)
// ─────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const c = await db.prepare('SELECT status FROM cobrancas WHERE id = ?').get(req.params.id) as any;
    if (!c) return res.status(404).json({ error: 'Cobrança não encontrada' });
    if (c.status !== 'pending') return res.status(400).json({ error: 'Apenas cobranças pendentes podem ser editadas' });

    const { notes } = req.body;
    await db.prepare(`UPDATE cobrancas SET notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?`)
      .run(notes, req.params.id);

    res.json(await db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(req.params.id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/cobrancas/:id/cancel
// ─────────────────────────────────────────────
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const c = await db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(req.params.id) as any;
    if (!c) return res.status(404).json({ error: 'Cobrança não encontrada' });

    if (c.provider_payment_id) {
      try { await cancelAsaasPayment(c.provider_payment_id); } catch { /* ignore */ }
    }

    await db.prepare(`UPDATE cobrancas SET status = 'cancelled', updated_at = NOW() WHERE id = ?`)
      .run(req.params.id);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
