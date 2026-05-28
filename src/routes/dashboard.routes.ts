import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { startOfMonth, endOfMonth, format, subMonths } from 'date-fns';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const mStart = format(startOfMonth(now), 'yyyy-MM-dd');
    const mEnd   = format(endOfMonth(now), 'yyyy-MM-dd');
    const mLabel = format(now, 'yyyy-MM');

    const income  = await db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='income' AND status='completed' AND date BETWEEN ? AND ?`).get(mStart, mEnd) as any;
    const expense = await db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='expense' AND status='completed' AND date BETWEEN ? AND ?`).get(mStart, mEnd) as any;
    const taxRes  = await db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM tax_reserves WHERE status='pending'`).get() as any;
    const fixedEx = await db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM fixed_expenses WHERE is_active=true AND frequency='monthly'`).get() as any;
    const nfse    = await db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(valor_servicos),0) as total FROM nfse_records WHERE status IN ('authorized','sent') AND TO_CHAR(data_emissao::date,'YYYY-MM')=?`).get(mLabel) as any;

    // Cash flow — last 6 months
    const cashFlow = [];
    for (let i = 5; i >= 0; i--) {
      const md   = subMonths(now, i);
      const s    = format(startOfMonth(md), 'yyyy-MM-dd');
      const e    = format(endOfMonth(md), 'yyyy-MM-dd');
      const lbl  = format(md, 'MMM/yy');
      const mInc = await db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='income' AND status='completed' AND date BETWEEN ? AND ?`).get(s, e) as any;
      const mExp = await db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='expense' AND status='completed' AND date BETWEEN ? AND ?`).get(s, e) as any;
      const mTax = await db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM tax_reserves WHERE reference_month=?`).get(format(md,'yyyy-MM')) as any;
      cashFlow.push({ month: lbl, income: +mInc.total, expense: +mExp.total, tax: +mTax.total, profit: +mInc.total - +mExp.total });
    }

    const catBreakdown = await db.prepare(`
      SELECT category, COALESCE(SUM(amount),0) as total
      FROM transactions WHERE type='expense' AND status='completed' AND date BETWEEN ? AND ?
      GROUP BY category ORDER BY total DESC
    `).all(mStart, mEnd);

    const recentTx = await db.prepare(`
      SELECT t.*, c.name as client_name FROM transactions t
      LEFT JOIN clients c ON t.client_id = c.id
      ORDER BY t.date DESC, t.created_at DESC LIMIT 8
    `).all();

    const upcomingFixed = await db.prepare(`SELECT * FROM fixed_expenses WHERE is_active=true ORDER BY due_day ASC LIMIT 5`).all();

    res.json({
      kpis: {
        monthIncome: +income.total, monthExpense: +expense.total,
        monthProfit: +income.total - +expense.total,
        taxReservePending: +taxRes.total,
        fixedExpensesMonthly: +fixedEx.total,
        nfseCount: +nfse.count, nfseTotal: +nfse.total,
      },
      cashFlow, categoryBreakdown: catBreakdown, recentTransactions: recentTx, upcomingFixed,
    });
  } catch (e: any) {
    console.error('Dashboard error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
