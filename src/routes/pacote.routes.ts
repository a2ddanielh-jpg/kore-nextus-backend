import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { customAlphabet } from 'nanoid';
import {
  createPixPayment,
  type MpPayerInput,
} from '../services/mercadopago.service';
import { notifyCobrancaCreated } from '../services/telegram.service';

const router = Router();
const nanoid = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 10);
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3001';

const PACOTES: Record<string, { valor: number; descricao: string }> = {
  especial: { valor: 367, descricao: 'Identidade Visual — Pacote Especial' },
  premium:  { valor: 487, descricao: 'Identidade Visual — Pacote Premium'  },
};

// POST /api/pacotes/checkout
// Public — called from the landing page lead-capture form
router.post('/checkout', async (req: Request, res: Response) => {
  try {
    const { pacote, nome, email, cpf } = req.body as {
      pacote?: string;
      nome?: string;
      email?: string;
      cpf?: string;
    };

    if (!pacote || !PACOTES[pacote]) {
      return res.status(400).json({ error: 'Pacote inválido. Use "especial" ou "premium".' });
    }
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (!email?.trim() || !email.includes('@')) return res.status(400).json({ error: 'E-mail inválido.' });

    const cpfClean = (cpf || '').replace(/\D/g, '');
    if (cpfClean.length !== 11) return res.status(400).json({ error: 'CPF deve ter 11 dígitos.' });

    const { valor, descricao } = PACOTES[pacote];

    // Get or create client by CPF
    let client = await db.prepare(
      'SELECT * FROM clients WHERE cpf_cnpj = ?'
    ).get(cpfClean) as any;

    if (!client) {
      const clientId = uuidv4();
      await db.prepare(`
        INSERT INTO clients (id, name, cpf_cnpj, tipo_pessoa, razao_social, email, telefone,
          endereco, numero, complemento, bairro, municipio, uf, cep, codigo_municipio)
        VALUES (?, ?, ?, 'F', ?, ?, '', '', '', '', '', '', '', '', '')
      `).run(clientId, nome.trim(), cpfClean, nome.trim(), email.trim());

      client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    } else {
      // Update name/email if missing
      await db.prepare(`
        UPDATE clients SET
          name = COALESCE(NULLIF(name,''), ?),
          email = COALESCE(NULLIF(email,''), ?)
        WHERE id = ?
      `).run(nome.trim(), email.trim(), client.id);
    }

    const public_id = nanoid();
    const id = uuidv4();
    const dueDate = null; // no fixed expiry

    const payer: MpPayerInput = {
      name: nome.trim(),
      email: email.trim(),
      cpfCnpj: cpfClean,
      tipoPessoa: 'F',
    };

    // Create PIX payment
    let pixQrCode = '';
    let pixQrBase64 = '';
    let pixExpiresAt = '';
    let mpPaymentId = '';

    try {
      const pix = await createPixPayment(valor, descricao, public_id, payer, dueDate);
      mpPaymentId = pix.paymentId;
      pixQrCode = pix.qrCode;
      pixQrBase64 = pix.qrCodeBase64 ? `data:image/png;base64,${pix.qrCodeBase64}` : '';
      pixExpiresAt = pix.expirationDate;
    } catch (e: any) {
      return res.status(500).json({ error: `Erro ao criar PIX: ${e.message}` });
    }

    await db.prepare(`
      INSERT INTO cobrancas (
        id, public_id, client_id, valor, descricao, codigo_servico, aliquota_iss,
        status, vencimento, payment_methods,
        picpay_payment_url, picpay_qr_content, picpay_qr_base64, picpay_expires_at,
        provider, provider_payment_id,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '1.07', 2.0, 'pending', ?, 'pix,card', '', ?, ?, ?, 'mercadopago', ?, ?, NOW(), NOW())
    `).run(
      id, public_id, client.id, valor, descricao,
      dueDate, pixQrCode, pixQrBase64, pixExpiresAt,
      mpPaymentId,
      `Pacote ${pacote} — lead do site`,
    );

    const publicUrl = `${PUBLIC_URL.replace(/\/$/, '')}/pagar/${public_id}`;

    notifyCobrancaCreated({
      clientName: nome.trim(),
      valor,
      publicUrl,
    }).catch((e: any) => console.warn('Telegram notify failed:', e.message));

    res.json({ publicId: public_id, redirectUrl: publicUrl });
  } catch (error: any) {
    console.error('Erro criar checkout pacote:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
