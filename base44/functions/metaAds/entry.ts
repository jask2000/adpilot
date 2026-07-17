import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const GRAPH = 'https://graph.facebook.com/v25.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('meta_ads');
    const headers = { 'Authorization': `Bearer ${accessToken}` };

    if (action === 'list_accounts') {
      const r = await fetch(`${GRAPH}/me/adaccounts?fields=account_id,name,currency,amount_spent&limit=100`, { headers });
      const data = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ accounts: data.data || [] });
    }

    if (action === 'list_campaigns') {
      const { account_id } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const cr = await fetch(`${GRAPH}/${actId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,buying_type&limit=200`, { headers });
      const cdata = await cr.json();
      if (cdata.error) return Response.json({ error: cdata.error.message }, { status: 502 });

      const insightsMap: Record<string, any> = {};
      try {
        const ir = await fetch(`${GRAPH}/${actId}/insights?fields=campaign_id,spend,clicks,impressions,reach,cpc,ctr&level=campaign&limit=200`, { headers });
        const idata = await ir.json();
        for (const row of (idata.data || [])) insightsMap[row.campaign_id] = row;
      } catch (_e) { /* insights optional */ }

      const campaigns = (cdata.data || []).map((c: any) => ({ ...c, insights: insightsMap[c.id] || null }));
      return Response.json({ campaigns });
    }

    if (action === 'update_status') {
      const { campaign_id, status } = body;
      if (!campaign_id || !status) return Response.json({ error: 'campaign_id and status required' }, { status: 400 });
      const r = await fetch(`${GRAPH}/${campaign_id}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true });
    }

    if (action === 'update_budget') {
      const { campaign_id, daily_budget } = body; // daily_budget in cents
      if (!campaign_id || daily_budget == null) return Response.json({ error: 'campaign_id and daily_budget required' }, { status: 400 });
      const r = await fetch(`${GRAPH}/${campaign_id}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_budget: String(daily_budget) }),
      });
      const data = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});