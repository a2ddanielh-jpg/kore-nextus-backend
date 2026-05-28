import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { generateRpsXml, signXml, sendToWebservice, simulateNfseEmission } from '../services/nfse.service';

const router = Router();

// Certificate upload setup
const certStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const certDir = path.join(__dirname, '../../certificates');
    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });
    cb(null, certDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `certificate_${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: certStorage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/x-pkcs12' || file.originalname.endsWith('.pfx') || file.originalname.endsWith('.p12')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos .pfx ou .p12 são aceitos'));
    }
  }
});

// GET /api/nfse — list all
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, startDate, endDate } = req.query;

    let query = `
      SELECT n.*, c.name as client_name, c.cpf_cnpj as client_cpf_cnpj
      FROM nfse_records n
      LEFT JOIN clients c ON n.client_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) { query += ' AND n.status = ?'; params.push(status); }
    if (startDate) { query += ' AND n.data_emissao >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND n.data_emissao <= ?'; params.push(endDate); }

    query += ' ORDER BY n.created_at DESC';

    res.json(await db.prepare(query).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/nfse/:id/xml — download signed XML (must come before /:id)
router.get('/:id/xml', async (req: Request, res: Response) => {
  try {
    const record = await db.prepare('SELECT xml_rps, numero_rps FROM nfse_records WHERE id = ?').get(req.params.id) as any;
    if (!record) return res.status(404).json({ error: 'NFS-e não encontrada' });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="RPS_${record.numero_rps}.xml"`);
    res.send(record.xml_rps);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/nfse/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const record = await db.prepare(`
      SELECT n.*, c.name as client_name FROM nfse_records n
      LEFT JOIN clients c ON n.client_id = c.id
      WHERE n.id = ?
    `).get(req.params.id);
    if (!record) return res.status(404).json({ error: 'NFS-e não encontrada' });
    res.json(record);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/nfse/emit — main NFS-e emission endpoint
router.post('/emit', async (req: Request, res: Response) => {
  try {
    const {
      client_id, discriminacao, codigo_servico,
      valor_servicos, valor_deducoes = 0, iss_retido = false,
      aliquota_iss, competencia, simulate = false
    } = req.body;

    if (!client_id || !discriminacao || !codigo_servico || !valor_servicos) {
      return res.status(400).json({ error: 'Campos obrigatórios: client_id, discriminacao, codigo_servico, valor_servicos' });
    }

    const settings = await db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
    const aliquota = aliquota_iss ? parseFloat(aliquota_iss) : (settings?.aliquota_iss || 2.0);
    const valorServicos = parseFloat(valor_servicos);
    const valorDeducoes = parseFloat(valor_deducoes) || 0;
    const valorIss = +(valorServicos * (aliquota / 100)).toFixed(2);
    const valorLiquido = +(valorServicos - valorDeducoes - (iss_retido ? valorIss : 0)).toFixed(2);

    // Generate RPS number
    const lastNfse = await db.prepare('SELECT numero_rps FROM nfse_records ORDER BY created_at DESC LIMIT 1').get() as any;
    const nextRps = lastNfse ? (parseInt(lastNfse.numero_rps) + 1).toString() : '1';

    const today = new Date().toISOString().split('T')[0];
    const compMonth = competencia || today;

    const nfseId = uuidv4();

    // Generate XML
    const xmlRps = generateRpsXml({
      numero_rps: nextRps,
      serie_rps: '1',
      data_emissao: today,
      competencia: compMonth,
      client_id,
      discriminacao,
      codigo_servico,
      valor_servicos: valorServicos,
      valor_deducoes: valorDeducoes,
      iss_retido,
      aliquota_iss: aliquota,
    });

    const signedXml = signXml(xmlRps, `RPS${nextRps}`);

    let nfseStatus = 'pending';
    let numeroNfse = '';
    let protocolo = '';
    let errorMessage = '';

    if (simulate || settings?.nfse_environment === 'simulacao') {
      const sim = simulateNfseEmission(nextRps);
      nfseStatus = 'authorized';
      numeroNfse = sim.numero;
      protocolo = sim.protocolo;
    } else {
      const result = await sendToWebservice(signedXml, settings?.nfse_environment || 'homologacao');
      if (result.success) {
        nfseStatus = result.numero ? 'authorized' : 'sent';
        numeroNfse = result.numero || '';
        protocolo = result.protocolo || '';
      } else {
        nfseStatus = 'error';
        errorMessage = result.error || 'Erro desconhecido';
      }
    }

    // Save NFS-e record
    await db.prepare(`
      INSERT INTO nfse_records (
        id, numero_nfse, numero_rps, serie_rps, tipo_rps, data_emissao, competencia,
        client_id, discriminacao, codigo_servico, valor_servicos, valor_deducoes,
        valor_iss, aliquota_iss, iss_retido, valor_liquido,
        status, xml_rps, numero_protocolo, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nfseId, numeroNfse, nextRps, '1', 'RPS', today, compMonth,
      client_id, discriminacao, codigo_servico, valorServicos, valorDeducoes,
      valorIss, aliquota, iss_retido ? true : false, valorLiquido,
      nfseStatus, signedXml, protocolo, errorMessage
    );

    // Auto-create income transaction if authorized
    if (nfseStatus === 'authorized' || nfseStatus === 'sent') {
      const txId = uuidv4();
      const taxPercent = settings?.tax_reserve_percent || 6.0;
      const taxAmount = +(valorServicos * (taxPercent / 100)).toFixed(2);

      await db.prepare(`
        INSERT INTO transactions (id, type, description, amount, date, category, status, client_id, nfse_id, notes, tax_reserve_amount)
        VALUES (?, 'income', ?, ?, ?, 'Nota Fiscal', 'completed', ?, ?, ?, ?)
      `).run(txId, `NFS-e ${numeroNfse || nextRps} — ${discriminacao.substring(0, 60)}`, valorServicos, today, client_id, nfseId, `NFS-e Nº ${numeroNfse || 'Pendente'} | RPS ${nextRps}`, taxAmount);

      await db.prepare('UPDATE nfse_records SET transaction_id = ? WHERE id = ?').run(txId, nfseId);

      await db.prepare(`
        INSERT INTO tax_reserves (id, transaction_id, amount, percent, reference_month, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(uuidv4(), txId, taxAmount, taxPercent, today.substring(0, 7));
    }

    const created = await db.prepare(`
      SELECT n.*, c.name as client_name FROM nfse_records n
      LEFT JOIN clients c ON n.client_id = c.id
      WHERE n.id = ?
    `).get(nfseId);

    res.status(201).json({
      nfse: created,
      status: nfseStatus,
      message: nfseStatus === 'authorized'
        ? `NFS-e ${numeroNfse} emitida com sucesso!`
        : nfseStatus === 'error'
          ? errorMessage
          : 'NFS-e enviada para processamento'
    });
  } catch (error: any) {
    console.error('NFS-e emission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/nfse/certificate — upload A1 certificate
router.post('/certificate', upload.single('certificate'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo de certificado não enviado' });

    const { password } = req.body;
    const certPath = req.file.path;

    await db.prepare(`
      UPDATE settings SET certificate_path = ?, certificate_password = ?, updated_at = NOW()
      WHERE id = 1
    `).run(certPath, password || '');

    res.json({ success: true, message: 'Certificado enviado com sucesso!', path: certPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/nfse/:id/cancel
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    await db.prepare(`UPDATE nfse_records SET status = 'cancelled', updated_at = NOW() WHERE id = ?`)
      .run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
