"use strict";
// ============================================================
// Telegram Bot Service — sends notifications
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMessage = sendMessage;
exports.notifyPaymentReceived = notifyPaymentReceived;
exports.notifyNfseEmitted = notifyNfseEmitted;
exports.notifyError = notifyError;
exports.notifyCobrancaCreated = notifyCobrancaCreated;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
function escapeMarkdown(text) {
    return text.replace(/([_*`\[\]()~>#+=|{}.!-])/g, '\\$1');
}
async function sendMessage(text, opts) {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.warn('⚠️  Telegram não configurado (TELEGRAM_BOT_TOKEN/CHAT_ID ausentes)');
        return false;
    }
    try {
        const response = await fetch(`${API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text,
                parse_mode: opts?.parse_mode || 'Markdown',
                disable_web_page_preview: true,
            }),
        });
        return response.ok;
    }
    catch (err) {
        console.error('Telegram send error:', err.message);
        return false;
    }
}
async function notifyPaymentReceived(data) {
    const valorFmt = data.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const msg = `💰 *Pagamento Recebido!*\n\n` +
        `👤 *Cliente:* ${data.clientName}\n` +
        `💵 *Valor:* R$ ${valorFmt}\n` +
        `📝 *Serviço:* ${data.descricao}\n` +
        `${data.method ? `💳 *Método:* ${data.method}\n` : ''}` +
        `\n⚙️ Emitindo NFS-e automaticamente...`;
    await sendMessage(msg);
}
async function notifyNfseEmitted(data) {
    const valorFmt = data.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const msg = `✅ *NFS-e Emitida com sucesso!*\n\n` +
        `📋 *Número:* ${data.numero}\n` +
        `👤 *Cliente:* ${data.clientName}\n` +
        `💵 *Valor:* R$ ${valorFmt}`;
    await sendMessage(msg);
}
async function notifyError(context, error) {
    const msg = `❌ *Erro:* ${context}\n\n` +
        `\`${error.substring(0, 300)}\``;
    await sendMessage(msg);
}
async function notifyCobrancaCreated(data) {
    const valorFmt = data.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const msg = `🧾 *Nova Cobrança gerada*\n\n` +
        `👤 ${data.clientName}\n` +
        `💵 R$ ${valorFmt}\n\n` +
        `🔗 ${data.publicUrl}`;
    await sendMessage(msg);
}
//# sourceMappingURL=telegram.service.js.map