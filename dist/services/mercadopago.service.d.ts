export interface MpPayerInput {
    name: string;
    email: string;
    cpfCnpj: string;
    tipoPessoa: 'F' | 'J';
}
export interface MpPixResult {
    paymentId: string;
    qrCode: string;
    qrCodeBase64: string;
    ticketUrl: string;
    expirationDate: string;
}
export declare function createPixPayment(amount: number, description: string, externalReference: string, payer: MpPayerInput, vencimento: string | null): Promise<MpPixResult>;
export interface MpPreferenceResult {
    preferenceId: string;
    initPoint: string;
    sandboxInitPoint: string;
}
export declare function createPreference(amount: number, description: string, externalReference: string, payerEmail: string, vencimento: string | null, successUrl?: string): Promise<MpPreferenceResult>;
export declare function getPayment(paymentId: string): Promise<any>;
export declare function cancelPixPayment(paymentId: string): Promise<boolean>;
export declare function verifyWebhookSignature(xSignature: string | undefined, xRequestId: string | undefined, dataId: string | undefined): boolean;
export declare function createCardPayment(amount: number, description: string, externalReference: string, cardFormData: any): Promise<any>;
export declare function mpMethodLabel(paymentTypeId: string): string;
//# sourceMappingURL=mercadopago.service.d.ts.map