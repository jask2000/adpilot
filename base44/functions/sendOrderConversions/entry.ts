import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

const GRAPH = 'https://graph.facebook.com/v25.0';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// SHA-256 hex hash (Meta requires user data hashed before sending).
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function decodeBase64Url(b64) {
  const s = (b64 || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - s.length % 4) : '';
  const bin = atob(s + pad);
  try { return decodeURIComponent(escape(bin)); } catch { return bin; }
}

// Walk a Gmail message payload and pull out the first text/plain (or text/html) body.
function extractText(payload) {
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
  const plain = candidates.find(c => c.mime === 'text/plain');
  const html = candidates.find(c => c.mime === 'text/html');
  let text = decodeBase64Url(plain ? plain.data : (html ? html.data : (candidates[0]?.data || '')));
  if (html && !plain) text = text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
  return text;
}

// Normalize a phone number to E.164 (assume Canada/US +1) for hashing.
function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  let normalized = digits;
  if (digits.length === 10) normalized = '1' + digits;
  else if (digits.length === 11 && digits.startsWith('1')) normalized = digits;
  else if (digits.length === 0) return null;
  return '+' + normalized;
}

function parseOrderEmail(text) {
  const orderNo = (text.match(/Order#\s*(\d+)/i) || [])[1] || '';
  const placedOn = (text.match(/Placed On:\s*([^\n\r]+)/i) || [])[1]?.trim() || '';
  const name = (text.match(/Customer Name:\s*([^\n\r]+)/i) || [])[1]?.trim() || '';
  const phone = (text.match(/Phone:\s*([\d\s\-()]+)/i) || [])[1]?.trim() || '';
  const email = (text.match(/Email:\s*([^\s]+)/i) || [])[1]?.trim() || '';
  const balance = (text.match(/Balance Owing:\s*\$?([\d.,]+)/i) || [])[1]
    || (text.match(/Total:\s*\$?([\d.,]+)/i) || [])[1]
    || (text.match(/\$([\d.,]+\.\d{2})/g) || []).pop()?.replace(/[^\d.]/g, '');
  const amount = balance ? parseFloat(String(balance).replace(/,/g, '')) : 0;
  const orderType = (text.match(/Online Order\s*\(([^)]+)\)/i) || [])[1]?.trim() || '';
  const storeMatch = text.match(/^(.*HELLCRUST.*)$/im);
  const store = storeMatch ? storeMatch[1].trim() : '';

  // Parse the placed-on date into a unix timestamp.
  let eventTime = Math.floor(Date.now() / 1000);
  if (placedOn) {
    const cleaned = placedOn.replace(/^\w+,/, '').replace(/\s*@\s*/, ' ').trim();
    const parsed = Date.parse(cleaned);
    if (!isNaN(parsed)) eventTime = Math.floor(parsed / 1000);
  }

  return { orderNo, placedOn, name, phone, email, amount, orderType, store, eventTime };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // Admin-only when invoked manually; allow the scheduled workflow (no user session).
    try {
      const user = await base44.auth.me();
      if (user && user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    } catch (_e) { /* workflow context — proceed as service */ }

    const { accessToken: gmailToken } = await base44.asServiceRole.connectors.getConnection('gmail');
    const authHeader = { Authorization: `Bearer ${gmailToken}` };

    const PIXEL_ID = secrets.get('META_PIXEL_ID');
    const CONVERSIONS_TOKEN = secrets.get('META_CONVERSIONS_TOKEN');
    if (!PIXEL_ID || !CONVERSIONS_TOKEN) {
      return Response.json({ error: 'Missing META_PIXEL_ID or META_CONVERSIONS_TOKEN' }, { status: 500 });
    }

    // Find unread order confirmation emails.
    const listRes = await fetch(`${GMAIL_API}/messages?q=${encodeURIComponent('subject:Online Order is:unread')}&maxResults=25`, { headers: authHeader });
    const listData = await listRes.json();
    const messageIds = listData.messages || [];

    const processed = [];
    const errors = [];

    for (const msg of messageIds) {
      const mRes = await fetch(`${GMAIL_API}/messages/${msg.id}?format=full`, { headers: authHeader });
      if (!mRes.ok) { errors.push({ id: msg.id, error: 'fetch failed' }); continue; }
      const message = await mRes.json();
      const text = extractText(message.payload);
      const parsed = parseOrderEmail(text);
      if (!parsed.orderNo) { errors.push({ id: msg.id, error: 'no order number' }); continue; }

      // De-dupe: skip only if already successfully sent. Retry error records.
      const existing = await base44.asServiceRole.entities.ProcessedOrder.filter({ order_number: parsed.orderNo });
      const prior = existing[0];
      if (prior && prior.status === 'sent') {
        await fetch(`${GMAIL_API}/messages/${msg.id}/modify`, {
          method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        });
        processed.push({ orderNo: parsed.orderNo, skipped: true });
        continue;
      }

      // Build the Meta Conversions API payload with hashed user data.
      const userData = {};
      if (parsed.email) userData.em = [await sha256Hex(parsed.email.toLowerCase().trim())];
      const phoneNorm = normalizePhone(parsed.phone);
      if (phoneNorm) userData.ph = [await sha256Hex(phoneNorm)];

      const eventPayload = {
        data: [{
          event_name: 'Purchase',
          event_time: parsed.eventTime,
          action_source: 'website',
          event_id: parsed.orderNo,
          event_source_url: 'https://hellcrustpizz.com',
          user_data: userData,
          custom_data: {
            value: parsed.amount || 0,
            currency: 'CAD',
            content_type: 'restaurant',
            content_name: parsed.store,
            order_type: parsed.orderType
          }
        }]
      };

      const metaRes = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(CONVERSIONS_TOKEN)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventPayload)
      });
      const metaJson = await metaRes.json();

      const status = (metaJson && (metaJson.events_received || (!metaJson.error))) ? 'sent' : 'error';
      const errMsg = metaJson.error ? (metaJson.error.message || JSON.stringify(metaJson.error)) : null;

      const recordData = {
        customer_name: parsed.name,
        customer_email: parsed.email,
        customer_phone: parsed.phone,
        amount: parsed.amount || 0,
        store_name: parsed.store,
        order_type: parsed.orderType,
        order_date: parsed.placedOn,
        gmail_message_id: msg.id,
        meta_event_id: parsed.orderNo,
        status,
        error_message: errMsg,
        sent_at: new Date().toISOString()
      };
      if (prior) {
        await base44.asServiceRole.entities.ProcessedOrder.update(prior.id, recordData);
      } else {
        await base44.asServiceRole.entities.ProcessedOrder.create({ order_number: parsed.orderNo, ...recordData });
      }

      if (status === 'sent') {
        // Mark the email read so it won't be re-scanned.
        await fetch(`${GMAIL_API}/messages/${msg.id}/modify`, {
          method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        });
      }

      processed.push({ orderNo: parsed.orderNo, store: parsed.store, amount: parsed.amount, status, error: errMsg });
    }

    return Response.json({
      scanned: messageIds.length,
      sent: processed.filter(p => p.status === 'sent').length,
      skipped: processed.filter(p => p.skipped).length,
      errors: errors.length,
      processed
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}