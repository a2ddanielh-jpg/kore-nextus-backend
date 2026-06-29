"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const router = (0, express_1.Router)();

router.get('/', async (_req, res) => {
  try {
    const rows = await database_1.db.prepare(`SELECT * FROM agency_projects ORDER BY production_start_date DESC`).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { client_name, client_code, production_start_date, deadline_days, estimated_delivery_date, total_amount, amount_paid, gateway_fee, payment_method, project_link, briefing_link, status, notes } = req.body;
    if (!client_name || !production_start_date) return res.status(400).json({ error: 'client_name e production_start_date são obrigatórios' });
    const { client_name, client_code, production_start_date, deadline_days, estimated_delivery_date, total_amount, amount_paid, net_amount, payment_method, project_link, briefing_link, status, notes } = req.body;
    const row = await database_1.db.prepare(`INSERT INTO agency_projects (client_name,client_code,production_start_date,deadline_days,estimated_delivery_date,total_amount,amount_paid,net_amount,payment_method,project_link,briefing_link,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).get(client_name, client_code||'', production_start_date, deadline_days||30, estimated_delivery_date||production_start_date, total_amount||0, amount_paid||0, net_amount||0, payment_method||'pix', project_link||'', briefing_link||'', status||'em_producao', notes||'');
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { client_name, client_code, production_start_date, deadline_days, estimated_delivery_date, total_amount, amount_paid, net_amount, payment_method, project_link, briefing_link, status, notes } = req.body;
    const row = await database_1.db.prepare(`UPDATE agency_projects SET client_name=COALESCE(?,client_name),client_code=COALESCE(?,client_code),production_start_date=COALESCE(?,production_start_date),deadline_days=COALESCE(?,deadline_days),estimated_delivery_date=COALESCE(?,estimated_delivery_date),total_amount=COALESCE(?,total_amount),amount_paid=COALESCE(?,amount_paid),net_amount=COALESCE(?,net_amount),payment_method=COALESCE(?,payment_method),project_link=COALESCE(?,project_link),briefing_link=COALESCE(?,briefing_link),status=COALESCE(?,status),notes=COALESCE(?,notes),updated_at=NOW() WHERE id=? RETURNING *`).get(client_name,client_code,production_start_date,deadline_days,estimated_delivery_date,total_amount,amount_paid,net_amount,payment_method,project_link,briefing_link,status,notes,req.params.id);
    if (!row) return res.status(404).json({ error: 'Projeto não encontrado' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await database_1.db.prepare('DELETE FROM agency_projects WHERE id=?').run(req.params.id);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

exports.default = router;
