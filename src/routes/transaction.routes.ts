import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const { type, status, startDate, endDate, category, limit = '50', offset = '0' } = req.query;
    let query = `SELECT t.*, c.name as client_name, c.cpf_cnpj as client_cpf_cnpj
      FROM transactions t LEFT JOIN clients c ON t.client_id = c.id WHERE 1=1`;
    const params: any[] = [];
    if (type)      { query += ` AND t.type = ?`;      params.push(type); }
    if (status)    { query += ` AND t.status = ?`;    params.push(status); }
    if (category)  { query += ` AND t.category = ?`;  params.push(category); }
    if (startDate) { query += ` AND t.date >= ?`;     params.push(startDate); }
    if (endDate)   { query += ` AND t.date <= ?`;     params.push(endDate); }
    query += ` ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));
    const transactions = await db.prepare(query).all(...params);

    let countQ = `SELECT COUNT(*) as count FROM transactions t WHERE 1=1`;
    const cp: any[] = [];
    if (type)      { countQ += ` AND t.type = ?`;     cp.push(type); }
    if (status)    { countQ += ` AND t.status = ?`;   cp.push(status); }
    if (category)  { countQ += ` AND t.category = ?`; cp.push(category); }
    if (startDate) { countQ += ` AND t.date >= ?`;    cp.push(startDate); }
    if (endDate)   { countQ += ` AND t.date <= ?`;    cp.push(endDate); }
    const countRow = await db.prepare(countQ).get(...cp);
    res.json({ transactions, total: Number(countRow?.count ?? 0) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/summary/categories', async (req: Request, res: Response) => {
  try {
    const { type = 'expense', year } = req.query;
    const y = year || new Date().getFullYear().toString();
    const cats = await db.prepare(`
      SELECT category, SUM(amount) as total, COUNT(*) as count
      FROM transactions
      WHERE type = ? AND status = 'completed' AND TO_CHAR(date::date,'YYYY') = ?
      GROUP BY category ORDER BY total DESC
    `).all(type, y);
    res.json(cats);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tx = await db.prepare(`
      SELECT t.*, c.name as client_name FROM transactions t
      LEFT JOIN clients c ON t.client_id = c.id WHERE t.id = ?
    `).get(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transação não encontrada' });
    res.json(tx);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { type, description, amount, date, category, status = 'completed', client_id, notes } = req.body;
    if (!type || !description || !amount || !date)
      return res.status(400).json({ error: 'Campos obrigatórios: type, description, amount, date' });
    const id = uuidv4();
    const num = parseFloat(amount);
    const settingsRow = await db.prepare('SELECT tax_reserve_percent FROM settings WHERE id = 1').get() as any;
    const taxPct = settingsRow?.tax_reserve_percent ?? 6.0;
    const taxAmt = type === 'income' ? +(num * (taxPct / 100)).toFixed(2) : 0;
    await db.prepare(`
      INSERT INTO transactions (id, type, description, amount, date, category, status, client_id, notes, tax_reserve_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, description, num, date, category||'Outros', status, client_id||null, notes||'', taxAmt);
    if (type === 'income' && taxAmt > 0) {
      await db.prepare(`
        INSERT INTO tax_reserves (id, transaction_id, amount, percent, reference_month, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(uuidv4(), id, taxAmt, taxPct, date.substring(0, 7));
    }
    res.status(201).json(await db.prepare('SELECT * FROM transactions WHERE id = ?').get(id));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { description, amount, date, category, status, notes } = req.body;
    await db.prepare(`
      UPDATE transactions SET description=COALESCE(?,description), amount=COALESCE(?,amount),
        date=COALESCE(?,date), category=COALESCE(?,category), status=COALESCE(?,status),
        notes=COALESCE(?,notes), updated_at=NOW()
      WHERE id=?
    `).run(description, amount ? parseFloat(amount) : null, date, category, status, notes, req.params.id);
    res.json(await db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.prepare('DELETE FROM tax_reserves WHERE transaction_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
