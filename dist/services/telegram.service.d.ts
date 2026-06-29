export declare function sendMessage(text: string, opts?: {
    parse_mode?: 'MarkdownV2' | 'Markdown' | 'HTML';
}): Promise<boolean>;
export declare function notifyPaymentReceived(data: {
    clientName: string;
    valor: number;
    descricao: string;
    cobrancaId: string;
    method?: string;
}): Promise<void>;
export declare function notifyNfseEmitted(data: {
    numero: string;
    clientName: string;
    valor: number;
}): Promise<void>;
export declare function notifyError(context: string, error: string): Promise<void>;
export declare function notifyCobrancaCreated(data: {
    clientName: string;
    valor: number;
    publicUrl: string;
}): Promise<void>;
//# sourceMappingURL=telegram.service.d.ts.map