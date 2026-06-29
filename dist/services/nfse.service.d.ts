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
export declare function generateRpsXml(data: NfseData): string;
export declare function signXml(xmlString: string, referenceId: string): string;
export declare function sendToWebservice(signedXml: string, environment: string): Promise<{
    success: boolean;
    response: string;
    numero?: string;
    protocolo?: string;
    error?: string;
}>;
export declare function simulateNfseEmission(rpsNumber: string): {
    success: boolean;
    numero: string;
    protocolo: string;
};
export {};
//# sourceMappingURL=nfse.service.d.ts.map