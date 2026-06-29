"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRpsXml = generateRpsXml;
exports.signXml = signXml;
exports.sendToWebservice = sendToWebservice;
exports.simulateNfseEmission = simulateNfseEmission;
const node_forge_1 = __importDefault(require("node-forge"));
const xml_crypto_1 = require("xml-crypto");
const xmlbuilder2_1 = require("xmlbuilder2");
const database_1 = require("../db/database");
const fs_1 = __importDefault(require("fs"));
// Load certificate from settings
function loadCertificate() {
    const settings = database_1.db.prepare('SELECT certificate_path, certificate_password FROM settings WHERE id = 1').get();
    if (!settings?.certificate_path || !fs_1.default.existsSync(settings.certificate_path)) {
        return null;
    }
    try {
        const pfxBuffer = fs_1.default.readFileSync(settings.certificate_path);
        const p12Der = node_forge_1.default.util.createBuffer(pfxBuffer.toString('binary'));
        const p12Asn1 = node_forge_1.default.asn1.fromDer(p12Der);
        const p12 = node_forge_1.default.pkcs12.pkcs12FromAsn1(p12Asn1, settings.certificate_password || '');
        const certBags = p12.getBags({ bagType: node_forge_1.default.pki.oids.certBag });
        const keyBags = p12.getBags({ bagType: node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag });
        const certBag = certBags[node_forge_1.default.pki.oids.certBag]?.[0];
        const keyBag = keyBags[node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag]?.[0];
        if (!certBag?.cert || !keyBag?.key)
            return null;
        const pem = node_forge_1.default.pki.certificateToPem(certBag.cert);
        const keyPem = node_forge_1.default.pki.privateKeyToPem(keyBag.key);
        return { key: keyPem, cert: pem };
    }
    catch (e) {
        console.error('Erro ao carregar certificado:', e);
        return null;
    }
}
// Generate RPS XML according to ABRASF 2.02 schema (used by Caxias do Sul / Ginfes)
function generateRpsXml(data) {
    const settings = database_1.db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const client = database_1.db.prepare('SELECT * FROM clients WHERE id = ?').get(data.client_id);
    if (!client)
        throw new Error('Cliente não encontrado');
    const valorIss = +(data.valor_servicos * (data.aliquota_iss / 100)).toFixed(2);
    const valorLiquido = +(data.valor_servicos - data.valor_deducoes - (data.iss_retido ? valorIss : 0)).toFixed(2);
    // Build XML using xmlbuilder2 — ABRASF 2.02 standard
    const root = (0, xmlbuilder2_1.create)({ version: '1.0', encoding: 'UTF-8' })
        .ele('EnviarLoteRpsEnvio', {
        xmlns: 'http://www.abrasf.org.br/nfse.xsd'
    })
        .ele('LoteRps', { versao: '2.02' })
        .ele('NumeroLote').txt('1').up()
        .ele('CpfCnpj')
        .ele('Cnpj').txt(settings.cnpj?.replace(/\D/g, '') || '').up()
        .up()
        .ele('InscricaoMunicipal').txt(settings.inscricao_municipal || '').up()
        .ele('QuantidadeRps').txt('1').up()
        .ele('ListaRps')
        .ele('Rps')
        .ele('InfDeclaracaoPrestacaoServico', { Id: `RPS${data.numero_rps}` })
        .ele('Rps')
        .ele('IdentificacaoRps')
        .ele('Numero').txt(data.numero_rps).up()
        .ele('Serie').txt(data.serie_rps).up()
        .ele('Tipo').txt('1').up()
        .up()
        .ele('DataEmissao').txt(data.data_emissao).up()
        .ele('Status').txt('1').up()
        .up()
        .ele('Competencia').txt(data.competencia).up()
        .ele('Servico')
        .ele('Valores')
        .ele('ValorServicos').txt(data.valor_servicos.toFixed(2)).up()
        .ele('ValorDeducoes').txt(data.valor_deducoes.toFixed(2)).up()
        .ele('ValorIss').txt(valorIss.toFixed(2)).up()
        .ele('Aliquota').txt((data.aliquota_iss / 100).toFixed(4)).up()
        .ele('ValorLiquidoNfse').txt(valorLiquido.toFixed(2)).up()
        .up()
        .ele('IssRetido').txt(data.iss_retido ? '1' : '2').up()
        .ele('ItemListaServico').txt(data.codigo_servico).up()
        .ele('CodigoTributacaoMunicipio').txt(data.codigo_servico.replace('.', '')).up()
        .ele('Discriminacao').txt(data.discriminacao).up()
        .ele('CodigoMunicipio').txt('4305108').up() // Caxias do Sul IBGE code
        .ele('CodigoPais').txt('1058').up()
        .ele('ExigibilidadeISS').txt('1').up()
        .up()
        .ele('Prestador')
        .ele('CpfCnpj')
        .ele('Cnpj').txt(settings.cnpj?.replace(/\D/g, '') || '').up()
        .up()
        .ele('InscricaoMunicipal').txt(settings.inscricao_municipal || '').up()
        .up()
        .ele('Tomador')
        .ele('IdentificacaoTomador')
        .ele('CpfCnpj')
        .ele(client.tipo_pessoa === 'F' ? 'Cpf' : 'Cnpj').txt(client.cpf_cnpj?.replace(/\D/g, '') || '').up()
        .up()
        .up()
        .ele('RazaoSocial').txt(client.razao_social || client.name).up()
        .ele('Endereco')
        .ele('Endereco').txt(client.endereco || 'Não informado').up()
        .ele('Numero').txt(client.numero || 'S/N').up()
        .ele('Complemento').txt(client.complemento || '').up()
        .ele('Bairro').txt(client.bairro || 'Não informado').up()
        .ele('CodigoMunicipio').txt(client.codigo_municipio || '4305108').up()
        .ele('Uf').txt(client.uf || 'RS').up()
        .ele('CodigoPais').txt('1058').up()
        .ele('Cep').txt(client.cep?.replace(/\D/g, '') || '00000000').up()
        .up()
        .ele('Contato')
        .ele('Telefone').txt(client.telefone?.replace(/\D/g, '') || '').up()
        .ele('Email').txt(client.email || '').up()
        .up()
        .up()
        .ele('OptanteSimplesNacional').txt(settings.regime_tributario === 1 ? '1' : '2').up()
        .ele('IncentivoFiscal').txt('2').up()
        .up()
        .up()
        .up()
        .up()
        .up();
    return root.end({ prettyPrint: true });
}
// Sign XML with A1 certificate
function signXml(xmlString, referenceId) {
    const certData = loadCertificate();
    if (!certData) {
        console.warn('⚠️  Certificado não configurado — XML não será assinado (modo simulação)');
        return xmlString;
    }
    const sig = new xml_crypto_1.SignedXml({
        privateKey: certData.key,
        publicCert: certData.cert,
    });
    sig.addReference({
        xpath: `//*[@Id='${referenceId}']`,
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/2001/10/xml-exc-c14n#'
        ],
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
    sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
    sig.computeSignature(xmlString);
    return sig.getSignedXml();
}
// Send to Caxias do Sul WebService via SOAP
async function sendToWebservice(signedXml, environment) {
    const endpoint = environment === 'producao'
        ? 'https://nfse.caxiasdosul.rs.gov.br/nfse.asmx'
        : 'https://nfse-hml.caxiasdosul.rs.gov.br/nfse.asmx'; // homologação
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <RecepcionarLoteRps xmlns="http://www.abrasf.org.br/nfse.xsd">
      <nfseDadosMsg>
        ${Buffer.from(signedXml).toString('base64')}
      </nfseDadosMsg>
    </RecepcionarLoteRps>
  </soap:Body>
</soap:Envelope>`;
    try {
        const https = await Promise.resolve().then(() => __importStar(require('https')));
        const url = new URL(endpoint);
        return new Promise((resolve) => {
            const postData = Buffer.from(soapEnvelope, 'utf-8');
            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': '"http://www.abrasf.org.br/nfse.xsd/RecepcionarLoteRps"',
                    'Content-Length': postData.length,
                },
                rejectUnauthorized: false // some municipal servers have self-signed certs
            };
            const req = https.request(options, (res2) => {
                let data = '';
                res2.on('data', chunk => { data += chunk; });
                res2.on('end', () => {
                    // Parse response
                    const numMatch = data.match(/<NumeroNfse>(\d+)<\/NumeroNfse>/);
                    const protMatch = data.match(/<Protocolo>([^<]+)<\/Protocolo>/);
                    const errMatch = data.match(/<Mensagem>([^<]+)<\/Mensagem>/);
                    if (numMatch) {
                        resolve({ success: true, response: data, numero: numMatch[1], protocolo: protMatch?.[1] });
                    }
                    else if (errMatch) {
                        resolve({ success: false, response: data, error: errMatch[1] });
                    }
                    else {
                        resolve({ success: true, response: data });
                    }
                });
            });
            req.on('error', (e) => {
                resolve({ success: false, response: '', error: e.message });
            });
            req.write(postData);
            req.end();
        });
    }
    catch (e) {
        return { success: false, response: '', error: e.message };
    }
}
// Simulate NFS-e emission (when no certificate or in sandbox mode)
function simulateNfseEmission(rpsNumber) {
    const numero = String(Math.floor(Math.random() * 99000) + 1000);
    const protocolo = `SIM${Date.now()}`;
    return { success: true, numero, protocolo };
}
//# sourceMappingURL=nfse.service.js.map