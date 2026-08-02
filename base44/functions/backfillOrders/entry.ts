import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { GMAIL_API, GRAPH, sha256Hex, extractText, normalizePhone, parseOrderEmail } from '../../shared/orderEmail.ts';

const SINCE_DATE = '2026/05/01';
const SEVEN_DAYS = 7 * 24 * 60 * 60;

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try { user = await base44.auth.me(); } catch (_e) {}
    if (user && user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 20, 1), 40);

    const { accessToken: gmailToken } = await base44.asServiceRole.connectors.getConnection('gmail');
    const authHeader = { Authorization: `Bearer ${gmailToken}` };

    const PIXEL_ID = secrets.get('META_PIXEL_ID');
    const CONVERSIONS_TOKEN = secrets.get('META_CONVERSIONS_TOKEN');

    // Collect every order-email ID since the cutoff (IDs only — cheap list calls).
    const allIds = [];
    let pageToken = '';
    for (let i = 0; i < 40; i++) {
      const url = `${GMAIL_API}/messages?q=${encodeURIComponent('subject:Online Order after:' + SINCE_DATE)}&maxResults=500` + (pageToken ? `&pageToken=${pageToken}` : '');
      const listRes = await fetch(url, { headers: authHeader });
      const listData = await listRes.json();
      for (const m of listData.messages || []) allIds.push(m.id);
      pageToken = listData.nextPageToken || '';
      if (!pageToken) break;
    }

    // Already-captured orders (by gmail message id and by order number).
    const existing = await base44.asServiceRole.entities.ProcessedOrder.list('-created_date', 10000);
    const byGmail = new Set();
    const byOrder = new Set();
    for (const r of existing || []) {
      if (r.gmail_message_id) byGmail.add(r.gmail_message_id);
      if (r.order_number) byOrder.add(r.order_number);
    }

    const unprocessed = allIds.filter((id) => !byGmail.has(id));
    const toProcess = unprocessed.slice(0, batchSize);

    let captured = 0;
    let sentMeta = 0;
    let skipped = 0;
    let failed = 0;
    const now = Math.floor(Date.now() / 1000);

    for (const msgId of toProcess) {
      const mRes = await fetch(`${GMAIL_API}/messages/${msgId}?format=full`, { headers: authHeader });
      if (!mRes.ok) { failed++; continue; }
      const message = await mRes.json();
      const text = extractText(message.payload);
      const parsed = parseOrderEmail(text);
      if (!parsed.orderNo) { failed++; continue; }

      // Already captured by order number — just mark read and skip.
      if (byOrder.has(parsed.orderNo)) {
        skipped++;
        await fetch(`${GMAIL_API}/messages/${msgId}/modify`, {
          method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        }).catch(() => {});
        continue;
      }

      const isRecent = (now - parsed.eventTime) < SEVEN_DAYS;
      let status = 'sent';
      let errMsg = null;

      // Only send to Meta for orders within the attribution window; older
      // historical events are rejected by Meta ("Invalid parameter") and hold
      // no attribution value, so we just capture the record.
      if (isRecent && PIXEL_ID && CONVERSIONS_TOKEN) {
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
            custom_data: { value: parsed.amount || 0, currency: 'CAD', content_type: 'restaurant', content_name: parsed.store, order_type: parsed.orderType }
          }]
        };
        const metaRes = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(CONVERSIONS_TOKEN)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(eventPayload)
        });
        const metaJson = await metaRes.json();
        if (metaJson && (metaJson.events_received || !metaJson.error)) {
          status = 'sent';
          sentMeta++;
        } else {
          status = 'error';
          errMsg = metaJson.error ? (metaJson.error.message || JSON.stringify(metaJson.error)) : 'meta error';
          failed++;
        }
      } else {
        captured++;
      }

      await base44.asServiceRole.entities.ProcessedOrder.create({
        order_number: parsed.orderNo,
        customer_name: parsed.name,
        customer_email: parsed.email,
        customer_phone: parsed.phone,
        amount: parsed.amount || 0,
        store_name: parsed.store,
        order_type: parsed.orderType,
        order_date: new Date(parsed.eventTime * 1000).toISOString(),
        gmail_message_id: msgId,
        meta_event_id: parsed.orderNo,
        status,
        error_message: errMsg,
        sent_at: new Date().toISOString()
      });
      byOrder.add(parsed.orderNo);

      if (status === 'sent') {
        await fetch(`${GMAIL_API}/messages/${msgId}/modify`, {
          method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        }).catch(() => {});
      }
    }

    return Response.json({
      scanned: allIds.length,
      unprocessed: unprocessed.length,
      batch: toProcess.length,
      captured,
      sent_meta: sentMeta,
      skipped,
      failed,
      remaining: Math.max(0, unprocessed.length - toProcess.length),
      hasMore: unprocessed.length > toProcess.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}