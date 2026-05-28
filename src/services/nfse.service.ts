import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { create } from 'xmlbuilder2';
import { db } from '../db/database';
import fs from 'fs';
import path from 'path';

interface NfseData {
  numero_rps: string;
  serie_rps: string;
  data_emissao: string;
  competencia: string;
  client_id: string;
  discriminacao: string;
  codigo_servico: string;
  valor_servicos: number;
  valor_deducoes: number;
  iss_retido: boolean;
  aliquota_iss: number;
}

// Load certificate from settings
function loadCertificate(): { key: string; cert: string } | null {
  const settings = db.prepare('SELECT certificate_path, certificate_password FROM settings WHERE id = 1').get() as any;
  if (!settings?.certificate_path || !fs.existsSync(settings.certificate_path)) {
    return null;
  }

  try {
    const pfxBuffer = fs.readFileSync(settings.certificate_path);
    const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, settings.certificate_password || '');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];

    if (!certBag?.cert || !keyBag?.key) return null;

    const pem = forge.pki.certificateToPem(certBag.cert);
    const keyPem = forge.pki.privateKeyToPem(keyBag.key);

    return { key: keyPem, cert: pem };
  } catch (e) {
    console.error('Erro ao carregar certificado:', e);
    return null;
  }
}

// Generate RPS XML according to ABRASF 2.02 schema (used by Caxias do Sul / Ginfes)
export function generateRpsXml(data: NfseData): string {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(data.client_id) as any;

  if (!client) throw new Error('Cliente não encontrado');

  const valorIss = +(data.valor_servicos * (data.aliquota_iss / 100)).toFixed(2);
  const valorLiquido = +(data.valor_servicos - data.valor_deducoes - (data.iss_retido ? valorIss : 0)).toFixed(2);

  // Build XML using xmlbuilder2 — ABRASF 2.02 standard
  const root = create({ version: '1.0', encoding: 'UTF-8' })
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
export function signXml(xmlString: string, referenceId: string): string {
  const certData = loadCertificate();
  if (!certData) {
    console.warn('⚠️  Certificado não configurado — XML não será assinado (modo simulação)');
    return xmlString;
  }

  const sig = new SignedXml({
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
export async function sendToWebservice(signedXml: string, environment: string): Promise<{ success: boolean; response: string; numero?: string; protocolo?: string; error?: string }> {
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
    const https = await import('https');
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
          } else if (errMatch) {
            resolve({ success: false, response: data, error: errMatch[1] });
          } else {
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
  } catch (e: any) {
    return { success: false, response: '', error: e.message };
  }
}

// Simulate NFS-e emission (when no certificate or in sandbox mode)
export function simulateNfseEmission(rpsNumber: string): { success: boolean; numero: string; protocolo: string } {
  const numero = String(Math.floor(Math.random() * 99000) + 1000);
  const protocolo = `SIM${Date.now()}`;
  return { success: true, numero, protocolo };
}
