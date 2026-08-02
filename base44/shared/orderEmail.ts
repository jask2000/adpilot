// Shared helpers for parsing HELLCRUST online-order confirmation emails and
// reporting them to the Meta Conversions API. Imported by both
// sendOrderConversions (unread scanning) and backfillOrders (historical backfill).

export const GRAPH = 'https://graph.facebook.com/v25.0';
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function decodeBase64Url(b64) {
  const s = (b64 || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  try { return decodeURIComponent(escape(bin)); } catch { return bin; }
}

export function extractText(payload) {
  if (!payload) return '';
  const candidates = [];
  if (payload.body && payload.body.data) candidates.push({ mime: payload.mimeType, data: payload.body.data });
  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.body && p.body.data) candidates.push({ mime: p.mimeType, data: p.body.data });
      if (p.parts) {
        for (const q of p.parts) {
          if (q.body && q.body.data) candidates.push({ mime: q.mimeType, data: q.body.data });
        }
      }
    }
  }
  const plain = candidates.find((c) => c.mime === 'text/plain');
  const html = candidates.find((c) => c.mime === 'text/html');
  let text = decodeBase64Url(plain ? plain.data : (html ? html.data : (candidates[0]?.data || '')));
  if (html && !plain) text = text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
  return text;
}

export function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  let normalized = digits;
  if (digits.length === 10) normalized = '1' + digits;
  else if (digits.length === 11 && digits.startsWith('1')) normalized = digits;
  else if (digits.length === 0) return null;
  return '+' + normalized;
}

export function parseOrderEmail(text) {
  const orderNo = (text.match(/Order#\s*(\d+)/i) || [])[1] || '';
  const placedOn = (text.match(/Placed On:\s*([^\n\r]+)/i) || [])[1]?.trim() || '';
  const name = (text.match(/Customer Name:\s*([^\n\r]+)/i) || [])[1]?.trim() || '';
  const phone = (text.match(/Phone:\s*([\d\s\-()]+)/i) || [])[1]?.trim() || '';
  const email = (text.match(/Email:\s*([^\s]+)/i) || [])[1]?.trim() || '';
  const cleanText = text.replace(/&nbsp;/g, ' ');
  const balance = (cleanText.match(/Order\s+Total:\s*\$?([\d.,]+)/i) || [])[1]
    || (cleanText.match(/\bAmount:\s*\$?([\d.,]+)/i) || [])[1]
    || (cleanText.match(/Balance\s+Owing:\s*\$?([\d.,]+)/i) || [])[1]
    || (cleanText.match(/\$([\d.,]+\.\d{2})/g) || []).pop()?.replace(/[^\d.]/g, '');
  const amount = balance ? parseFloat(String(balance).replace(/,/g, '')) : 0;
  const orderType = (text.match(/Online Order\s*\(([^)]+)\)/i) || [])[1]?.trim() || '';
  const storeMatch = text.match(/^(.*HELLCRUST.*)$/im);
  const store = storeMatch ? storeMatch[1].trim() : '';
  let eventTime = Math.floor(Date.now() / 1000);
  if (placedOn) {
    const cleaned = placedOn.replace(/^\w+,/, '').replace(/\s*@\s*/, ' ').trim();
    const parsed = Date.parse(cleaned);
    if (!isNaN(parsed)) eventTime = Math.floor(parsed / 1000);
  }
  return { orderNo, placedOn, name, phone, email, amount, orderType, store, eventTime };
}