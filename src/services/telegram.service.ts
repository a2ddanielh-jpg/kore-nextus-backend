// ============================================================
// Telegram Bot Service — sends notifications
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

function escapeMarkdown(text: string): string {
  return text.replace(/([_*`\[\]()~>#+=|{}.!-])/g, '\\$1');
}

export async function sendMessage(text: string, opts?: { parse_mode?: 'MarkdownV2' | 'Markdown' | 'HTML' }): Promise<boolean> {
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
  } catch (err: any) {
    console.error('Telegram send error:', err.message);
    return false;
  }
}

export async function notifyPaymentReceived(data: {
  clientName: string;
  valor: number;
  descricao: string;
  cobrancaId: string;
  method?: string;
}): Promise<void> {
  const valorFmt = data.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const msg =
    `💰 *Pagamento Recebido!*\n\n` +
    `👤 *Cliente:* ${data.clientName}\n` +
    `💵 *Valor:* R$ ${valorFmt}\n` +
    `📝 *Serviço:* ${data.descricao}\n` +
    `${data.method ? `💳 *Método:* ${data.method}\n` : ''}` +
    `\n⚙️ Emitindo NFS-e automaticamente...`;
  await sendMessage(msg);
}

export async function notifyNfseEmitted(data: {
  numero: string;
  clientName: string;
  valor: number;
}): Promise<void> {
  const valorFmt = data.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const msg =
    `✅ *NFS-e Emitida com sucesso!*\n\n` +
    `📋 *Número:* ${data.numero}\n` +
    `👤 *Cliente:* ${data.clientName}\n` +
    `💵 *Valor:* R$ ${valorFmt}`;
  await sendMessage(msg);
}

export async function notifyError(context: string, error: string): Promise<void> {
  const msg =
    `❌ *Erro:* ${context}\n\n` +
    `\`${error.substring(0, 300)}\``;
  await sendMessage(msg);
}

export async function notifyCobrancaCreated(data: {
  clientName: string;
  valor: number;
  publicUrl: string;
}): Promise<void> {
  const valorFmt = data.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const msg =
    `🧾 *Nova Cobrança gerada*\n\n` +
    `👤 ${data.clientName}\n` +
    `💵 R$ ${valorFmt}\n\n` +
    `🔗 ${data.publicUrl}`;
  await sendMessage(msg);
}
