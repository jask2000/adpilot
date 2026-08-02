import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // auto_send is invoked by the scheduled workflow (no user session);
    // the manual actions require a logged-in user.
    let user = null;
    try { user = await base44.auth.me(); } catch (_e) {}

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    const sid = secrets.get('TWILIO_ACCOUNT_SID');
    const token = secrets.get('TWILIO_AUTH_TOKEN');
    const rawFrom = secrets.get('TWILIO_FROM_NUMBER');
    const from = rawFrom ? (String(rawFrom).trim().startsWith('+') ? String(rawFrom).trim() : '+' + String(rawFrom).replace(/\D/g, '')) : null;
    if (!sid || !token || !from) return Response.json({ error: 'Twilio credentials not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in the app environment variables.' }, { status: 500 });

    const normalizePhone = (p) => {
      if (!p) return null;
      let d = String(p).replace(/\D/g, '');
      if (d.length === 10) d = '1' + d;
      if (d.length === 11 && d.startsWith('1')) return '+' + d;
      if (d.length > 11) return '+' + d;
      return null;
    };
    const parseOrderDate = (s) => {
      if (!s) return null;
      const str = String(s);
      const iso = new Date(str);
      if (!isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
      const m = str.match(/[A-Za-z]{3},\s*([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
      if (m) {
        const d = new Date(`${m[1]} ${m[2]} ${m[3]}`);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
      return null;
    };
    const sendSms = async (to, text, mediaUrl) => {
      const dest = normalizePhone(to);
      if (!dest) throw new Error('Invalid phone number: ' + to);
      const form = new URLSearchParams();
      form.set('To', dest);
      form.set('From', from);
      form.set('Body', text);
      if (mediaUrl) form.set('MediaUrl', mediaUrl);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + btoa(`${sid}:${token}`) },
        body: form,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || data.error_message || `HTTP ${r.status}`);
      return data;
    };

    const yesterdayStr = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (action === 'preview') {
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const { date } = body;
      const targetDate = date || yesterdayStr();
      const orders = await base44.asServiceRole.entities.ProcessedOrder.list('-created_date', 500);
      const dayOrders = orders.filter((o) => {
        const od = parseOrderDate(o.order_date);
        return od === targetDate && normalizePhone(o.customer_phone);
      });
      const already = await base44.asServiceRole.entities.SmsMessage.filter({ campaign_date: targetDate });
      const sentSet = new Set(already.filter((s) => s.status === 'sent').map((s) => s.order_number));
      const failedSet = new Set(already.filter((s) => s.status === 'failed').map((s) => s.order_number));
      const customers = dayOrders.map((o) => ({
        order_number: o.order_number,
        customer_name: o.customer_name,
        customer_phone: o.customer_phone,
        store_name: o.store_name,
        already_sent: sentSet.has(o.order_number),
        previously_failed: failedSet.has(o.order_number),
      }));
      return Response.json({ date: targetDate, customers });
    }

    if (action === 'send') {
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const { recipients, message, date, media_url } = body;
      if (!Array.isArray(recipients) || !recipients.length) return Response.json({ error: 'recipients required' }, { status: 400 });
      if (!message) return Response.json({ error: 'message required' }, { status: 400 });
      const campaignDate = date || yesterdayStr();
      const existing = await base44.asServiceRole.entities.SmsMessage.filter({ campaign_date: campaignDate });
      const existingMap = {};
      for (const e of existing) existingMap[e.order_number] = e;
      const results = [];
      for (const r of recipients) {
        if (!r.customer_phone) { results.push({ order_number: r.order_number, status: 'failed', error: 'no phone' }); continue; }
        const existingRec = existingMap[r.order_number];
        try {
          await sendSms(r.customer_phone, message, media_url);
          if (existingRec) {
            await base44.asServiceRole.entities.SmsMessage.delete(existingRec.id);
          }
          await base44.asServiceRole.entities.SmsMessage.create({
            order_number: r.order_number, customer_name: r.customer_name, customer_phone: r.customer_phone,
            store_name: r.store_name, message, campaign_date: campaignDate, status: 'sent',
            sent_at: new Date().toISOString(), source: 'manual',
          });
          results.push({ order_number: r.order_number, status: 'sent' });
        } catch (e) {
          if (existingRec) {
            await base44.asServiceRole.entities.SmsMessage.update(existingRec.id, {
              status: 'failed', error_message: e.message, message, campaign_date: campaignDate,
              sent_at: new Date().toISOString(), source: 'manual',
            });
          } else {
            await base44.asServiceRole.entities.SmsMessage.create({
              order_number: r.order_number, customer_name: r.customer_name, customer_phone: r.customer_phone,
              store_name: r.store_name, message, campaign_date: campaignDate, status: 'failed',
              error_message: e.message, sent_at: new Date().toISOString(), source: 'manual',
            });
          }
          results.push({ order_number: r.order_number, status: 'failed', error: e.message });
        }
      }
      return Response.json({
        results,
        sent: results.filter((r) => r.status === 'sent').length,
        failed: results.filter((r) => r.status === 'failed').length,
      });
    }

    if (action === 'auto_send') {
      // Scheduled-workflow path: no user session, sends a default thank-you to yesterday's customers.
      const targetDate = yesterdayStr();
      const orders = await base44.asServiceRole.entities.ProcessedOrder.list('-created_date', 500);
      const dayOrders = orders.filter((o) => {
        const od = parseOrderDate(o.order_date);
        return od === targetDate && normalizePhone(o.customer_phone);
      });
      const already = await base44.asServiceRole.entities.SmsMessage.filter({ campaign_date: targetDate, source: 'auto' });
      const sentSet = new Set(already.map((s) => s.order_number));
      const toSend = dayOrders.filter((o) => !sentSet.has(o.order_number));
      const defaultMsg = 'Thanks for your order at HELLCRUST PIZZA! We hope you enjoyed it. See you again soon — order at hellcrustpizza.com';
      let sent = 0, failed = 0;
      for (const o of toSend) {
        try {
          await sendSms(o.customer_phone, defaultMsg);
          await base44.asServiceRole.entities.SmsMessage.create({
            order_number: o.order_number, customer_name: o.customer_name, customer_phone: o.customer_phone,
            store_name: o.store_name, message: defaultMsg, campaign_date: targetDate, status: 'sent',
            sent_at: new Date().toISOString(), source: 'auto',
          });
          sent++;
        } catch (e) {
          await base44.asServiceRole.entities.SmsMessage.create({
            order_number: o.order_number, customer_name: o.customer_name, customer_phone: o.customer_phone,
            store_name: o.store_name, message: defaultMsg, campaign_date: targetDate, status: 'failed',
            error_message: e.message, sent_at: new Date().toISOString(), source: 'auto',
          });
          failed++;
        }
      }
      return Response.json({ date: targetDate, sent, failed, total: toSend.length });
    }

    if (action === 'schedule') {
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const { recipients, message, media_url, send_at } = body;
      if (!Array.isArray(recipients) || !recipients.length) return Response.json({ error: 'recipients required' }, { status: 400 });
      if (!message) return Response.json({ error: 'message required' }, { status: 400 });
      if (!send_at) return Response.json({ error: 'send_at required' }, { status: 400 });
      const when = new Date(send_at);
      if (isNaN(when.getTime())) return Response.json({ error: 'invalid send_at' }, { status: 400 });
      const valid = recipients.filter((r) => r.customer_phone);
      if (!valid.length) return Response.json({ error: 'no recipients with a phone number' }, { status: 400 });
      const created = await base44.asServiceRole.entities.ScheduledSms.create({
        message,
        media_url: media_url || null,
        send_at: when.toISOString(),
        status: 'pending',
        recipients: valid.map((r) => ({
          order_number: r.order_number,
          customer_name: r.customer_name,
          customer_phone: r.customer_phone,
          store_name: r.store_name || '',
        })),
      });
      return Response.json({ id: created.id, scheduled_for: when.toISOString(), recipient_count: valid.length });
    }

    if (action === 'processDue') {
      // Invoked by the ScheduledSmsRunner workflow (no user session).
      // Finds pending campaigns whose send_at is in the past and dispatches them.
      const now = new Date();
      const pending = await base44.asServiceRole.entities.ScheduledSms.filter({ status: 'pending' }, 'send_at', 50);
      const due = pending.filter((c) => {
        const d = c.send_at ? new Date(c.send_at) : null;
        return d && !isNaN(d.getTime()) && d.getTime() <= now.getTime();
      });
      let campaigns = 0, totalSent = 0, totalFailed = 0;
      for (const camp of due) {
        let sent = 0, failed = 0;
        for (const r of (camp.recipients || [])) {
          try {
            await sendSms(r.customer_phone, camp.message, camp.media_url || undefined);
            await base44.asServiceRole.entities.SmsMessage.create({
              order_number: r.order_number || `SCH-${camp.id}`,
              customer_name: r.customer_name, customer_phone: r.customer_phone,
              store_name: r.store_name, message: camp.message,
              campaign_date: now.toISOString().slice(0, 10),
              status: 'sent', sent_at: now.toISOString(), source: 'manual',
            });
            sent++;
          } catch (e) {
            await base44.asServiceRole.entities.SmsMessage.create({
              order_number: r.order_number || `SCH-${camp.id}`,
              customer_name: r.customer_name, customer_phone: r.customer_phone,
              store_name: r.store_name, message: camp.message,
              campaign_date: now.toISOString().slice(0, 10),
              status: 'failed', error_message: e.message, sent_at: now.toISOString(), source: 'manual',
            });
            failed++;
          }
        }
        await base44.asServiceRole.entities.ScheduledSms.update(camp.id, {
          status: 'sent', sent_count: sent, failed_count: failed, processed_at: now.toISOString(),
        });
        campaigns++; totalSent += sent; totalFailed += failed;
      }
      return Response.json({ processed: campaigns, sent: totalSent, failed: totalFailed });
    }

    if (action === 'cancelScheduled') {
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const { id } = body;
      if (!id) return Response.json({ error: 'id required' }, { status: 400 });
      await base44.asServiceRole.entities.ScheduledSms.update(id, { status: 'cancelled' });
      return Response.json({ id, status: 'cancelled' });
    }

    if (action === 'listScheduled') {
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const records = await base44.asServiceRole.entities.ScheduledSms.list('-send_at', 50);
      return Response.json({ scheduled: records });
    }

    if (action === 'history') {
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const { limit } = body;
      const records = await base44.asServiceRole.entities.SmsMessage.list('-sent_at', limit || 100);
      return Response.json({ history: records });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}