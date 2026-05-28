// ============================================================
// Asaas Gateway — PIX + Cartão + NFS-e automática
// Docs: https://docs.asaas.com/
// Auth: header "access_token" (NOT Bearer)
// ============================================================

const API_URL = process.env.ASAAS_API_URL || 'https://api.asaas.com/v3';
const API_KEY = process.env.ASAAS_API_KEY || '';

function authHeaders(): Record<string, string> {
  return {
    'access_token': API_KEY,
    'Content-Type': 'application/json',
    'User-Agent': 'KoreNextus/1.0',
  };
}

async function call(path: string, method: 'GET' | 'POST' | 'DELETE' | 'PUT', body?: any): Promise<any> {
  if (!API_KEY) throw new Error('ASAAS_API_KEY não configurada no .env');

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!response.ok) {
    const msg = data.errors?.[0]?.description || data.errors?.[0]?.message || data.message || `HTTP ${response.status}`;
    throw new Error(`Asaas ${method} ${path} → ${msg}`);
  }

  return data;
}

// ─────────────────────────────────────────────
// CUSTOMER
// ─────────────────────────────────────────────
export interface AsaasCustomerInput {
  name: string;
  cpfCnpj: string;        // numbers only
  email?: string;
  phone?: string;
  mobilePhone?: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;       // bairro
  externalReference?: string;
}

export async function findCustomerByCpfCnpj(cpfCnpj: string): Promise<string | null> {
  const clean = cpfCnpj.replace(/\D/g, '');
  const data = await call(`/customers?cpfCnpj=${clean}&limit=1`, 'GET');
  return data.data?.[0]?.id || null;
}

export async function createCustomer(input: AsaasCustomerInput): Promise<string> {
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

export async function getOrCreateCustomer(input: AsaasCustomerInput): Promise<string> {
  const existing = await findCustomerByCpfCnpj(input.cpfCnpj);
  if (existing) return existing;
  return await createCustomer(input);
}

// ─────────────────────────────────────────────
// PAYMENT
// ─────────────────────────────────────────────
export interface AsaasPaymentInput {
  customerId: string;
  value: number;
  dueDate: string;          // YYYY-MM-DD
  description: string;
  externalReference: string; // our public_id
  billingType?: 'UNDEFINED' | 'PIX' | 'CREDIT_CARD' | 'BOLETO';
  callback?: {
    successUrl?: string;
    autoRedirect?: boolean;
  };
}

export interface AsaasPaymentResponse {
  id: string;
  status: string;
  invoiceUrl: string;
  dueDate: string;
  value: number;
}

export async function createPayment(input: AsaasPaymentInput): Promise<AsaasPaymentResponse> {
  const body: any = {
    customer: input.customerId,
    billingType: input.billingType || 'UNDEFINED',
    value: input.value,
    dueDate: input.dueDate,
    description: input.description.substring(0, 500),
    externalReference: input.externalReference,
    postalService: false,
  };

  if (input.callback) body.callback = input.callback;

  const data = await call('/payments', 'POST', body);
  return {
    id: data.id,
    status: data.status,
    invoiceUrl: data.invoiceUrl,
    dueDate: data.dueDate,
    value: data.value,
  };
}

export async function getPayment(paymentId: string): Promise<any> {
  return await call(`/payments/${paymentId}`, 'GET');
}

export async function cancelPayment(paymentId: string): Promise<boolean> {
  try {
    await call(`/payments/${paymentId}`, 'DELETE');
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// PIX QR CODE
// ─────────────────────────────────────────────
export interface PixQrCode {
  encodedImage: string;      // base64 PNG (without data:image prefix)
  payload: string;            // copia-cola
  expirationDate: string;
}

export async function getPixQrCode(paymentId: string): Promise<PixQrCode | null> {
  try {
    const data = await call(`/payments/${paymentId}/pixQrCode`, 'GET');
    if (!data.success) return null;
    return {
      encodedImage: data.encodedImage,
      payload: data.payload,
      expirationDate: data.expirationDate,
    };
  } catch (e: any) {
    console.warn('Erro getPixQrCode:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// WEBHOOK
// ─────────────────────────────────────────────
export type AsaasEvent =
  | 'PAYMENT_CREATED'
  | 'PAYMENT_AWAITING_RISK_ANALYSIS'
  | 'PAYMENT_APPROVED_BY_RISK_ANALYSIS'
  | 'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
  | 'PAYMENT_UPDATED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_DELETED'
  | 'PAYMENT_REFUNDED'
  | 'INVOICE_CREATED'
  | 'INVOICE_UPDATED'
  | 'INVOICE_SYNCHRONIZED'
  | 'INVOICE_AUTHORIZED'
  | 'INVOICE_PROCESSING_CANCELLATION'
  | 'INVOICE_CANCELED'
  | 'INVOICE_CANCELLATION_DENIED'
  | 'INVOICE_ERROR';

export interface AsaasWebhookPayload {
  event: AsaasEvent;
  payment?: any;
  invoice?: any;
}

export function parseWebhook(body: any): AsaasWebhookPayload | null {
  if (!body?.event) return null;
  return body as AsaasWebhookPayload;
}
