import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { GMAIL_API, GRAPH, sha256Hex, extractText, normalizePhone, parseOrderEmail } from '../../shared/orderEmail.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

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

    const listRes = await fetch(`${GMAIL_API}/messages?q=${encodeURIComponent('subject:Online Order is:unread')}&maxResults=100`, { headers: authHeader });
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
        order_date: new Date(parsed.eventTime * 1000).toISOString(),
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
        await fetch(`${GMAIL_API}/messages/${msg.id}/modify`, {
          method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        });
      }

      processed.push({ orderNo: parsed.orderNo, store: parsed.store, amount: parsed.amount, status, error: errMsg });
    }

    return Response.json({
      scanned: messageIds.length,
      sent: processed.filter((p) => p.status === 'sent').length,
      skipped: processed.filter((p) => p.skipped).length,
      errors: errors.length,
      processed
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}