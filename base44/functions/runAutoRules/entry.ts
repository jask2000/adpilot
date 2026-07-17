import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const GRAPH = 'https://graph.facebook.com/v25.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow admin users calling manually, and allow workflow (no user session).
    let isAdminContext = false;
    try {
      const user = await base44.auth.me();
      if (user) {
        if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
        isAdminContext = true;
      }
    } catch (_e) { /* no user session (workflow) — proceed as service */ }
    void isAdminContext;

    const rules = await base44.asServiceRole.entities.AutoRule.filter({ status: 'active' });
    if (!rules.length) return Response.json({ applied: 0, results: [], message: 'No active rules' });

    const configs = await base44.asServiceRole.entities.AppConfig.list();
    const config = configs[0];
    if (!config || !config.selected_ad_account_id) {
      return Response.json({ error: 'No ad account selected' }, { status: 400 });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('meta_ads');
    const headers = { 'Authorization': `Bearer ${accessToken}` };

    const rawId = config.selected_ad_account_id;
    const actId = String(rawId).startsWith('act_') ? rawId : `act_${rawId}`;

    const cr = await fetch(`${GRAPH}/${actId}/campaigns?fields=id,name,status,daily_budget&limit=200`, { headers });
    const cdata = await cr.json();
    if (cdata.error) return Response.json({ error: cdata.error.message }, { status: 502 });
    const campaigns = cdata.data || [];

    const insightsMap: Record<string, any> = {};
    try {
      const ir = await fetch(`${GRAPH}/${actId}/insights?fields=campaign_id,spend,clicks,impressions,reach,cpc,ctr&level=campaign&limit=200`, { headers });
      const idata = await ir.json();
      for (const row of (idata.data || [])) insightsMap[row.campaign_id] = row;
    } catch (_e) { /* ignore */ }

    const results: any[] = [];
    const nowIso = new Date().toISOString();

    for (const rule of rules) {
      for (const c of campaigns) {
        if (c.status !== 'ACTIVE') continue;
        const ins = insightsMap[c.id] || {};
        const raw = ins[rule.metric];
        if (raw == null) continue;
        const value = parseFloat(raw);
        if (isNaN(value)) continue;

        const threshold = Number(rule.threshold);
        let matched = false;
        if (rule.condition === 'greater_than' && value > threshold) matched = true;
        if (rule.condition === 'less_than' && value < threshold) matched = true;
        if (!matched) continue;

        if (rule.action === 'pause_campaign') {
          const r = await fetch(`${GRAPH}/${c.id}`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'PAUSED' }),
          });
          const d = await r.json();
          if (d.error) {
            results.push({ rule: rule.name, campaign: c.name, action: 'pause', error: d.error.message });
          } else {
            results.push({ rule: rule.name, campaign: c.name, action: 'paused' });
          }
        } else if (rule.action === 'set_budget' && rule.budget_value) {
          const cents = Math.round(Number(rule.budget_value) * 100);
          const r = await fetch(`${GRAPH}/${c.id}`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ daily_budget: String(cents) }),
          });
          const d = await r.json();
          if (d.error) {
            results.push({ rule: rule.name, campaign: c.name, action: 'set_budget', error: d.error.message });
          } else {
            results.push({ rule: rule.name, campaign: c.name, action: 'set_budget', budget: rule.budget_value });
          }
        }
      }
      await base44.asServiceRole.entities.AutoRule.update(rule.id, { last_run_date: nowIso });
    }

    return Response.json({ applied: results.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});