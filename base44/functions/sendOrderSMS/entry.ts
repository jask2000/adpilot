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
    const from = secrets.get('TWILIO_FROM_NUMBER');
    if (!sid || !token || !from) return Response.json({ error: 'Twilio credentials not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in the app environment variables.' }, { status: 500 });

    const sendSms = async (to, text) => {
      const form = new URLSearchParams();
      form.set('To', to);
      form.set('From', from);
      form.set('Body', text);
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
        const od = o.order_date ? String(o.order_date).slice(0, 10) : null;
        return od === targetDate && o.customer_phone;
      });
      const already = await base44.asServiceRole.entities.SmsMessage.filter({ campaign_date: targetDate });
      const sentSet = new Set(already.map((s) => s.order_number));
      const customers = dayOrders.map((o) => ({
        order_number: o.order_number,
        customer_name: o.customer_name,
        customer_phone: o.customer_phone,
        store_name: o.store_name,
        already_sent: sentSet.has(o.order_number),
      }));
      return Response.json({ date: targetDate, customers });
    }

    if (action === 'send') {
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const { recipients, message, date } = body;
      if (!Array.isArray(recipients) || !recipients.length) return Response.json({ error: 'recipients required' }, { status: 400 });
      if (!message) return Response.json({ error: 'message required' }, { status: 400 });
      const campaignDate = date || yesterdayStr();
      const results = [];
      for (const r of recipients) {
        if (!r.customer_phone) { results.push({ order_number: r.order_number, status: 'failed', error: 'no phone' }); continue; }
        try {
          await sendSms(r.customer_phone, message);
          await base44.asServiceRole.entities.SmsMessage.create({
            order_number: r.order_number, customer_name: r.customer_name, customer_phone: r.customer_phone,
            store_name: r.store_name, message, campaign_date: campaignDate, status: 'sent',
            sent_at: new Date().toISOString(), source: 'manual',
          });
          results.push({ order_number: r.order_number, status: 'sent' });
        } catch (e) {
          await base44.asServiceRole.entities.SmsMessage.create({
            order_number: r.order_number, customer_name: r.customer_name, customer_phone: r.customer_phone,
            store_name: r.store_name, message, campaign_date: campaignDate, status: 'failed',
            error_message: e.message, sent_at: new Date().toISOString(), source: 'manual',
          });
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
        const od = o.order_date ? String(o.order_date).slice(0, 10) : null;
        return od === targetDate && o.customer_phone;
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