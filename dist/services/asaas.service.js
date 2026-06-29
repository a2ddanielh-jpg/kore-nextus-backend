"use strict";
// ============================================================
// Asaas Gateway — PIX + Cartão + NFS-e automática
// Docs: https://docs.asaas.com/
// Auth: header "access_token" (NOT Bearer)
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.findCustomerByCpfCnpj = findCustomerByCpfCnpj;
exports.createCustomer = createCustomer;
exports.getOrCreateCustomer = getOrCreateCustomer;
exports.createPayment = createPayment;
exports.getPayment = getPayment;
exports.cancelPayment = cancelPayment;
exports.getPixQrCode = getPixQrCode;
exports.parseWebhook = parseWebhook;
const API_URL = process.env.ASAAS_API_URL || 'https://api.asaas.com/v3';
const API_KEY = process.env.ASAAS_API_KEY || '';
function authHeaders() {
    return {
        'access_token': API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'KoreNextus/1.0',
    };
}
async function call(path, method, body) {
    if (!API_KEY)
        throw new Error('ASAAS_API_KEY não configurada no .env');
    const response = await fetch(`${API_URL}${path}`, {
        method,
        headers: authHeaders(),
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = {};
    try {
        data = JSON.parse(text);
    }
    catch {
        data = { raw: text };
    }
    if (!response.ok) {
        const msg = data.errors?.[0]?.description || data.errors?.[0]?.message || data.message || `HTTP ${response.status}`;
        throw new Error(`Asaas ${method} ${path} → ${msg}`);
    }
    return data;
}
async function findCustomerByCpfCnpj(cpfCnpj) {
    const clean = cpfCnpj.replace(/\D/g, '');
    const data = await call(`/customers?cpfCnpj=${clean}&limit=1`, 'GET');
    return data.data?.[0]?.id || null;
}
async function createCustomer(input) {
    const body = {
        ...input,
        cpfCnpj: input.cpfCnpj.replace(/\D/g, ''),
        phone: input.phone?.replace(/\D/g, ''),
        mobilePhone: input.mobilePhone?.replace(/\D/g, ''),
        postalCode: input.postalCode?.replace(/\D/g, ''),
    };
    const data = await call('/customers', 'POST', body);
    return data.id;
}
async function getOrCreateCustomer(input) {
    const existing = await findCustomerByCpfCnpj(input.cpfCnpj);
    if (existing)
        return existing;
    return await createCustomer(input);
}
async function createPayment(input) {
    const body = {
        customer: input.customerId,
        billingType: input.billingType || 'UNDEFINED',
        value: input.value,
        dueDate: input.dueDate,
        description: input.description.substring(0, 500),
        externalReference: input.externalReference,
        postalService: false,
    };
    if (input.callback)
        body.callback = input.callback;
    const data = await call('/payments', 'POST', body);
    return {
        id: data.id,
        status: data.status,
        invoiceUrl: data.invoiceUrl,
        dueDate: data.dueDate,
        value: data.value,
    };
}
async function getPayment(paymentId) {
    return await call(`/payments/${paymentId}`, 'GET');
}
async function cancelPayment(paymentId) {
    try {
        await call(`/payments/${paymentId}`, 'DELETE');
        return true;
    }
    catch {
        return false;
    }
}
async function getPixQrCode(paymentId) {
    try {
        const data = await call(`/payments/${paymentId}/pixQrCode`, 'GET');
        if (!data.success)
            return null;
        return {
            encodedImage: data.encodedImage,
            payload: data.payload,
            expirationDate: data.expirationDate,
        };
    }
    catch (e) {
        console.warn('Erro getPixQrCode:', e.message);
        return null;
    }
}
function parseWebhook(body) {
    if (!body?.event)
        return null;
    return body;
}
//# sourceMappingURL=asaas.service.js.map