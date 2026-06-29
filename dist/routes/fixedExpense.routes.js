"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const uuid_1 = require("uuid");
const router = (0, express_1.Router)();
router.get('/summary/monthly', async (_req, res) => {
    try {
        const m = await database_1.db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM fixed_expenses WHERE is_active=true AND frequency='monthly'`).get();
        const q = await database_1.db.prepare(`SELECT COALESCE(SUM(amount/3.0),0) as total FROM fixed_expenses WHERE is_active=true AND frequency='quarterly'`).get();
        const y = await database_1.db.prepare(`SELECT COALESCE(SUM(amount/12.0),0) as total FROM fixed_expenses WHERE is_active=true AND frequency='yearly'`).get();
        res.json({ monthlyTotal: +m.total + +q.total + +y.total, yearlyTotal: +m.total * 12 + +q.total * 4 + +y.total });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.get('/', async (_req, res) => {
    try {
        res.json(await database_1.db.prepare('SELECT * FROM fixed_expenses ORDER BY due_day ASC').all());
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.post('/', async (req, res) => {
    try {
        const { description, amount, category, frequency = 'monthly', due_day = 1, start_date, end_date, notes } = req.body;
        if (!description || !amount || !start_date)
            return res.status(400).json({ error: 'Campos obrigatórios: description, amount, start_date' });
        const id = (0, uuid_1.v4)();
        await database_1.db.prepare(`INSERT INTO fixed_expenses (id, description, amount, category, frequency, due_day, start_date, end_date, is_active, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, ?)`).run(id, description, parseFloat(amount), category || 'Operacional', frequency, Number(due_day), start_date, end_date || null, notes || '');
        res.status(201).json(await database_1.db.prepare('SELECT * FROM fixed_expenses WHERE id=?').get(id));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.put('/:id', async (req, res) => {
    try {
        const { description, amount, category, frequency, due_day, is_active, end_date, notes } = req.body;
        await database_1.db.prepare(`UPDATE fixed_expenses SET
      description=COALESCE(?,description), amount=COALESCE(?,amount), category=COALESCE(?,category),
      frequency=COALESCE(?,frequency), due_day=COALESCE(?,due_day), is_active=COALESCE(?,is_active),
      end_date=COALESCE(?,end_date), notes=COALESCE(?,notes), updated_at=NOW() WHERE id=?
    `).run(description, amount ? parseFloat(amount) : null, category, frequency, due_day ? Number(due_day) : null, is_active !== undefined ? is_active : null, end_date, notes, req.params.id);
        res.json(await database_1.db.prepare('SELECT * FROM fixed_expenses WHERE id=?').get(req.params.id));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        await database_1.db.prepare('DELETE FROM fixed_expenses WHERE id=?').run(req.params.id);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.post('/:id/generate', async (req, res) => {
    try {
        const { month } = req.body;
        const fe = await database_1.db.prepare('SELECT * FROM fixed_expenses WHERE id=?').get(req.params.id);
        if (!fe)
            return res.status(404).json({ error: 'Gasto fixo não encontrado' });
        const existing = await database_1.db.prepare(`SELECT id FROM transactions WHERE description ILIKE ? AND date LIKE ? AND type='expense'`).get(`%${fe.description}%`, `${month}%`);
        if (existing)
            return res.status(409).json({ error: 'Já lançado para este mês' });
        const txId = (0, uuid_1.v4)();
        const date = `${month}-${String(fe.due_day).padStart(2, '0')}`;
        await database_1.db.prepare(`INSERT INTO transactions (id, type, description, amount, date, category, status, notes) VALUES (?, 'expense', ?, ?, ?, ?, 'pending', ?)`).run(txId, `[Fixo] ${fe.description}`, fe.amount, date, fe.category, `Gerado de gasto fixo: ${fe.description}`);
        res.status(201).json(await database_1.db.prepare('SELECT * FROM transactions WHERE id=?').get(txId));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
//# sourceMappingURL=fixedExpense.routes.js.map