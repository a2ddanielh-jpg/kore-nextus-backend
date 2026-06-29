"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const uuid_1 = require("uuid");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    try {
        const { search } = req.query;
        let query = 'SELECT * FROM clients WHERE 1=1';
        const params = [];
        if (search) {
            query += ' AND (name ILIKE ? OR cpf_cnpj ILIKE ? OR razao_social ILIKE ?)';
            const t = `%${search}%`;
            params.push(t, t, t);
        }
        query += ' ORDER BY name ASC';
        res.json(await database_1.db.prepare(query).all(...params));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.get('/:id', async (req, res) => {
    try {
        const c = await database_1.db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!c)
            return res.status(404).json({ error: 'Cliente não encontrado' });
        res.json(c);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.post('/', async (req, res) => {
    try {
        const { name, cpf_cnpj, tipo_pessoa = 'J', razao_social, email, telefone, endereco, numero, complemento, bairro, municipio, uf, cep, codigo_municipio } = req.body;
        if (!name || !cpf_cnpj)
            return res.status(400).json({ error: 'Campos obrigatórios: name, cpf_cnpj' });
        const id = (0, uuid_1.v4)();
        await database_1.db.prepare(`
      INSERT INTO clients (id, name, cpf_cnpj, tipo_pessoa, razao_social, email, telefone, endereco, numero, complemento, bairro, municipio, uf, cep, codigo_municipio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, cpf_cnpj, tipo_pessoa, razao_social || name, email || '', telefone || '', endereco || '', numero || '', complemento || '', bairro || '', municipio || '', uf || '', cep || '', codigo_municipio || '');
        res.status(201).json(await database_1.db.prepare('SELECT * FROM clients WHERE id = ?').get(id));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.put('/:id', async (req, res) => {
    try {
        const { name, cpf_cnpj, tipo_pessoa, razao_social, email, telefone, endereco, numero, complemento, bairro, municipio, uf, cep, codigo_municipio } = req.body;
        const now = new Date().toISOString();
        await database_1.db.prepare(`
      UPDATE clients SET name=COALESCE(?,name), cpf_cnpj=COALESCE(?,cpf_cnpj), tipo_pessoa=COALESCE(?,tipo_pessoa),
        razao_social=COALESCE(?,razao_social), email=COALESCE(?,email), telefone=COALESCE(?,telefone),
        endereco=COALESCE(?,endereco), numero=COALESCE(?,numero), complemento=COALESCE(?,complemento),
        bairro=COALESCE(?,bairro), municipio=COALESCE(?,municipio), uf=COALESCE(?,uf),
        cep=COALESCE(?,cep), codigo_municipio=COALESCE(?,codigo_municipio), updated_at=?
      WHERE id=?
    `).run(name, cpf_cnpj, tipo_pessoa, razao_social, email, telefone, endereco, numero, complemento, bairro, municipio, uf, cep, codigo_municipio, now, req.params.id);
        res.json(await database_1.db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        await database_1.db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
//# sourceMappingURL=client.routes.js.map