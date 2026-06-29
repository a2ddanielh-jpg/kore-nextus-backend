"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    try {
        res.json(await database_1.db.prepare('SELECT * FROM settings WHERE id = 1').get());
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.put('/', async (req, res) => {
    try {
        const { company_name, cnpj, inscricao_municipal, razao_social, endereco, municipio, uf, cep, telefone, email, regime_tributario, aliquota_iss, codigo_servico, tax_reserve_percent, certificate_password, nfse_environment } = req.body;
        await database_1.db.prepare(`
      UPDATE settings SET
        company_name=COALESCE(?,company_name), cnpj=COALESCE(?,cnpj),
        inscricao_municipal=COALESCE(?,inscricao_municipal), razao_social=COALESCE(?,razao_social),
        endereco=COALESCE(?,endereco), municipio=COALESCE(?,municipio), uf=COALESCE(?,uf),
        cep=COALESCE(?,cep), telefone=COALESCE(?,telefone), email=COALESCE(?,email),
        regime_tributario=COALESCE(?,regime_tributario), aliquota_iss=COALESCE(?,aliquota_iss),
        codigo_servico=COALESCE(?,codigo_servico), tax_reserve_percent=COALESCE(?,tax_reserve_percent),
        certificate_password=COALESCE(?,certificate_password), nfse_environment=COALESCE(?,nfse_environment),
        updated_at=NOW()
      WHERE id=1
    `).run(company_name, cnpj, inscricao_municipal, razao_social, endereco, municipio, uf, cep, telefone, email, regime_tributario ? Number(regime_tributario) : null, aliquota_iss ? parseFloat(aliquota_iss) : null, codigo_servico, tax_reserve_percent ? parseFloat(tax_reserve_percent) : null, certificate_password, nfse_environment);
        res.json(await database_1.db.prepare('SELECT * FROM settings WHERE id = 1').get());
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
//# sourceMappingURL=settings.routes.js.map