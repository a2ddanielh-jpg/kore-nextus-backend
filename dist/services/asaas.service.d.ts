export interface AsaasCustomerInput {
    name: string;
    cpfCnpj: string;
    email?: string;
    phone?: string;
    mobilePhone?: string;
    postalCode?: string;
    address?: string;
    addressNumber?: string;
    complement?: string;
    province?: string;
    externalReference?: string;
}
export declare function findCustomerByCpfCnpj(cpfCnpj: string): Promise<string | null>;
export declare function createCustomer(input: AsaasCustomerInput): Promise<string>;
export declare function getOrCreateCustomer(input: AsaasCustomerInput): Promise<string>;
export interface AsaasPaymentInput {
    customerId: string;
    value: number;
    dueDate: string;
    description: string;
    externalReference: string;
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
export declare function createPayment(input: AsaasPaymentInput): Promise<AsaasPaymentResponse>;
export declare function getPayment(paymentId: string): Promise<any>;
export declare function cancelPayment(paymentId: string): Promise<boolean>;
export interface PixQrCode {
    encodedImage: string;
    payload: string;
    expirationDate: string;
}
export declare function getPixQrCode(paymentId: string): Promise<PixQrCode | null>;
export type AsaasEvent = 'PAYMENT_CREATED' | 'PAYMENT_AWAITING_RISK_ANALYSIS' | 'PAYMENT_APPROVED_BY_RISK_ANALYSIS' | 'PAYMENT_REPROVED_BY_RISK_ANALYSIS' | 'PAYMENT_UPDATED' | 'PAYMENT_CONFIRMED' | 'PAYMENT_RECEIVED' | 'PAYMENT_OVERDUE' | 'PAYMENT_DELETED' | 'PAYMENT_REFUNDED' | 'INVOICE_CREATED' | 'INVOICE_UPDATED' | 'INVOICE_SYNCHRONIZED' | 'INVOICE_AUTHORIZED' | 'INVOICE_PROCESSING_CANCELLATION' | 'INVOICE_CANCELED' | 'INVOICE_CANCELLATION_DENIED' | 'INVOICE_ERROR';
export interface AsaasWebhookPayload {
    event: AsaasEvent;
    payment?: any;
    invoice?: any;
}
export declare function parseWebhook(body: any): AsaasWebhookPayload | null;
//# sourceMappingURL=asaas.service.d.ts.map