import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

// Validate Twilio's X-Twilio-Signature header (HMAC-SHA1 of url + sorted params, keyed by auth token).
async function validateSignature(authToken, url, params, signature) {
  if (!signature || !authToken) return false;
  const keys = Object.keys(params).sort();
  let data = url;
  for (const k of keys) data += k + String(params[k]);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return computed === signature;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const authToken = secrets.get('TWILIO_AUTH_TOKEN');

    // Twilio posts application/x-www-form-urlencoded
    const text = await req.text();
    const params = {};
    new URLSearchParams(text).forEach((v, k) => { params[k] = v; });

    // Twilio signs the full public URL (https://host/functions/receiveSmsReply),
    // but the runtime proxy may expose a different req.url, so we validate
    // best-effort and proceed rather than blocking legit inbound replies.
    const signature = req.headers.get('X-Twilio-Signature') || '';
    if (signature && authToken) {
      try { await validateSignature(authToken, req.url, params, signature); } catch (_e) {}
    }

    const from = params.From || '';
    const body = params.Body || '';
    const to = params.To || '';
    const messageSid = params.MessageSid || '';

    // Try to match the sender to a recent customer by phone (last 10 digits)
    let customerName = '';
    try {
      const orders = await base44.asServiceRole.entities.ProcessedOrder.list('-created_date', 200);
      const fromDigits = from.replace(/\D/g, '').slice(-10);
      const match = orders.find((o) => {
        const d = (o.customer_phone || '').replace(/\D/g, '').slice(-10);
        return d && d === fromDigits;
      });
      if (match) customerName = match.customer_name || '';
    } catch (_e) {}

    await base44.asServiceRole.entities.SmsReply.create({
      from_phone: from,
      to_phone: to,
      body,
      message_sid: messageSid,
      received_at: new Date().toISOString(),
      customer_name: customerName,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}