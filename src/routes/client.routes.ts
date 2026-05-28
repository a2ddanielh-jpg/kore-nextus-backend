import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM clients WHERE 1=1';
    const params: any[] = [];
    if (search) {
      query += ' AND (name ILIKE ? OR cpf_cnpj ILIKE ? OR razao_social ILIKE ?)';
      const t = `%${search}%`;
      params.push(t, t, t);
    }
    query += ' ORDER BY name ASC';
    res.json(await db.prepare(query).all(...params));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const c = await db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(c);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, cpf_cnpj, tipo_pessoa='J', razao_social, email, telefone, endereco, numero, complemento, bairro, municipio, uf, cep, codigo_municipio } = req.body;
    if (!name || !cpf_cnpj) return res.status(400).json({ error: 'Campos obrigatórios: name, cpf_cnpj' });
    const id = uuidv4();
    await db.prepare(`
      INSERT INTO clients (id, name, cpf_cnpj, tipo_pessoa, razao_social, email, telefone, endereco, numero, complemento, bairro, municipio, uf, cep, codigo_municipio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, cpf_cnpj, tipo_pessoa, razao_social||name, email||'', telefone||'', endereco||'', numero||'', complemento||'', bairro||'', municipio||'', uf||'', cep||'', codigo_municipio||'');
    res.status(201).json(await db.prepare('SELECT * FROM clients WHERE id = ?').get(id));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, cpf_cnpj, tipo_pessoa, razao_social, email, telefone, endereco, numero, complemento, bairro, municipio, uf, cep, codigo_municipio } = req.body;
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE clients SET name=COALESCE(?,name), cpf_cnpj=COALESCE(?,cpf_cnpj), tipo_pessoa=COALESCE(?,tipo_pessoa),
        razao_social=COALESCE(?,razao_social), email=COALESCE(?,email), telefone=COALESCE(?,telefone),
        endereco=COALESCE(?,endereco), numero=COALESCE(?,numero), complemento=COALESCE(?,complemento),
        bairro=COALESCE(?,bairro), municipio=COALESCE(?,municipio), uf=COALESCE(?,uf),
        cep=COALESCE(?,cep), codigo_municipio=COALESCE(?,codigo_municipio), updated_at=?
      WHERE id=?
    `).run(name, cpf_cnpj, tipo_pessoa, razao_social, email, telefone, endereco, numero, complemento, bairro, municipio, uf, cep, codigo_municipio, now, req.params.id);
    res.json(await db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
