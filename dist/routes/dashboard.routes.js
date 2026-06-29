"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const date_fns_1 = require("date-fns");
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    try {
        const now = new Date();
        const mStart = (0, date_fns_1.format)((0, date_fns_1.startOfMonth)(now), 'yyyy-MM-dd');
        const mEnd = (0, date_fns_1.format)((0, date_fns_1.endOfMonth)(now), 'yyyy-MM-dd');
        const mLabel = (0, date_fns_1.format)(now, 'yyyy-MM');
        const income = await database_1.db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='income' AND status='completed' AND date BETWEEN ? AND ?`).get(mStart, mEnd);
        const expense = await database_1.db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='expense' AND status='completed' AND date BETWEEN ? AND ?`).get(mStart, mEnd);
        const taxRes = await database_1.db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM tax_reserves WHERE status='pending'`).get();
        const fixedEx = await database_1.db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM fixed_expenses WHERE is_active=true AND frequency='monthly'`).get();
        const nfse = await database_1.db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(valor_servicos),0) as total FROM nfse_records WHERE status IN ('authorized','sent') AND TO_CHAR(data_emissao::date,'YYYY-MM')=?`).get(mLabel);
        // Cash flow — last 6 months
        const cashFlow = [];
        for (let i = 5; i >= 0; i--) {
            const md = (0, date_fns_1.subMonths)(now, i);
            const s = (0, date_fns_1.format)((0, date_fns_1.startOfMonth)(md), 'yyyy-MM-dd');
            const e = (0, date_fns_1.format)((0, date_fns_1.endOfMonth)(md), 'yyyy-MM-dd');
            const lbl = (0, date_fns_1.format)(md, 'MMM/yy');
            const mInc = await database_1.db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='income' AND status='completed' AND date BETWEEN ? AND ?`).get(s, e);
            const mExp = await database_1.db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='expense' AND status='completed' AND date BETWEEN ? AND ?`).get(s, e);
            const mTax = await database_1.db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM tax_reserves WHERE reference_month=?`).get((0, date_fns_1.format)(md, 'yyyy-MM'));
            cashFlow.push({ month: lbl, income: +mInc.total, expense: +mExp.total, tax: +mTax.total, profit: +mInc.total - +mExp.total });
        }
        const catBreakdown = await database_1.db.prepare(`
      SELECT category, COALESCE(SUM(amount),0) as total
      FROM transactions WHERE type='expense' AND status='completed' AND date BETWEEN ? AND ?
      GROUP BY category ORDER BY total DESC
    `).all(mStart, mEnd);
        const recentTx = await database_1.db.prepare(`
      SELECT t.*, c.name as client_name FROM transactions t
      LEFT JOIN clients c ON t.client_id = c.id
      ORDER BY t.date DESC, t.created_at DESC LIMIT 8
    `).all();
        const upcomingFixed = await database_1.db.prepare(`SELECT * FROM fixed_expenses WHERE is_active=true ORDER BY due_day ASC LIMIT 5`).all();
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
    }
    catch (e) {
        console.error('Dashboard error:', e);
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
//# sourceMappingURL=dashboard.routes.js.map