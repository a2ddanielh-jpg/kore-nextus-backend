"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");

const router = (0, express_1.Router)();

function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'INTERNAL_WEBHOOK_SECRET no configurado' });
  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'Secret inválido' });
  }
  next();
}

router.post('/crm-won', requireInternalSecret, async (req, res) => {
  try {
    const { lead_name, lead_phone, lead_value, lead_id, pipeline_name, stage_name } = req.body;
    if (!lead_name) return res.status(400).json({ error: 'lead_name es requerido' });

    const phone = String(lead_phone || '').replace(/\D/g, '');
    const client_code = phone.length >= 4 ? phone.slice(-4) : '';
    const today = new Date().toISOString().split('T')[0];
    const delivery = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

    const result = await database_1.pool.query(`
      INSERT INTO agency_projects
        (client_name, client_code, production_start_date, deadline_days,
         estimated_delivery_date, total_amount, amount_paid, payment_method,
         project_link, briefing_link, status, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id
    `, [
      lead_name, client_code, today, 30, delivery,
      Number(lead_value) || 0, 0, 'pix', '', '',
      'em_producao',
      `Importado do CRM (${pipeline_name || 'Pipeline Principal'} → ${stage_name || 'Cerrado'}) | Lead ID: ${lead_id || ''}`,
    ]);

    const newId = result.rows[0]?.id;
    console.log(`[CRM→Gestão] Projeto criado: ${newId} para "${lead_name}"`);
    res.status(201).json({ ok: true, project_id: newId });
  } catch (e) {
    console.error('[CRM→Gestão] Erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

exports.default = router;
