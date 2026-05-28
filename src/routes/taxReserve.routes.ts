import { Router, Request, Response } from 'express';
import { db } from '../db/database';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, year } = req.query;
    const y = year || new Date().getFullYear().toString();
    let query = `
      SELECT tr.*, t.description as transaction_description, t.amount as transaction_amount,
             t.date as transaction_date, c.name as client_name
      FROM tax_reserves tr
      JOIN transactions t ON tr.transaction_id = t.id
      LEFT JOIN clients c ON t.client_id = c.id
      WHERE TO_CHAR((tr.reference_month || '-01')::date,'YYYY') = ?`;
    const params: any[] = [y];
    if (status) { query += ` AND tr.status = ?`; params.push(status); }
    query += ` ORDER BY tr.reference_month DESC`;
    const reserves = await db.prepare(query).all(...params);

    const summary = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) as pending_total,
        COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) as paid_total,
        COALESCE(SUM(amount),0) as grand_total
      FROM tax_reserves
      WHERE TO_CHAR((reference_month || '-01')::date,'YYYY') = ?
    `).get(y);

    const monthly = await db.prepare(`
      SELECT reference_month, SUM(amount) as total, COUNT(*) as count,
             SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) as paid_count
      FROM tax_reserves
      WHERE TO_CHAR((reference_month || '-01')::date,'YYYY') = ?
      GROUP BY reference_month ORDER BY reference_month ASC
    `).all(y);

    res.json({ reserves, summary, monthly });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/month/:month/mark-paid', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString().substring(0, 10);
    await db.prepare(`UPDATE tax_reserves SET status='paid', paid_date=? WHERE reference_month=? AND status='pending'`).run(now, req.params.month);
    res.json({ success: true, month: req.params.month });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/mark-paid', async (req: Request, res: Response) => {
  try {
    const { paid_date, notes } = req.body;
    const d = paid_date || new Date().toISOString().substring(0, 10);
    await db.prepare(`UPDATE tax_reserves SET status='paid', paid_date=?, notes=COALESCE(?,notes) WHERE id=?`).run(d, notes, req.params.id);
    res.json(await db.prepare('SELECT * FROM tax_reserves WHERE id = ?').get(req.params.id));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/projection', async (_req: Request, res: Response) => {
  try {
    const y = new Date().getFullYear().toString();
    const avgRow = await db.prepare(`
      SELECT AVG(monthly_total) as avg FROM (
        SELECT TO_CHAR(date::date,'YYYY-MM') as month, SUM(amount) as monthly_total
        FROM transactions WHERE type='income' AND status='completed' AND TO_CHAR(date::date,'YYYY')=?
        GROUP BY month
      ) sub
    `).get(y) as any;
    const s = await db.prepare('SELECT tax_reserve_percent FROM settings WHERE id=1').get() as any;
    const pct = s?.tax_reserve_percent ?? 6.0;
    const avg = avgRow?.avg || 0;
    res.json({ taxPercent: pct, avgMonthlyIncome: +avg, projectedMonthlyTax: +avg*(pct/100), projectedAnnualTax: +avg*12*(pct/100) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
