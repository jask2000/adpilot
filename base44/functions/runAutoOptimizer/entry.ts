import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const GRAPH = 'https://graph.facebook.com/v25.0';
const MIN_SPEND = 5; // account-currency dollars an ad set must have spent to be judged

export default async function(req) {
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

    const body = await req.json().catch(() => ({}));
    const targetCampaignId = body?.campaign_id || null;

    const configs = await base44.asServiceRole.entities.AppConfig.list();
    const config = configs[0];
    if (!config || !config.selected_ad_account_id) {
      return Response.json({ error: 'No ad account selected' }, { status: 400 });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('meta_ads');
    const headers = { 'Authorization': `Bearer ${accessToken}` };
    const rawId = config.selected_ad_account_id;
    const actId = String(rawId).startsWith('act_') ? rawId : `act_${rawId}`;

    // Account-wide ad-set-level insights (one call, reused for every campaign).
    const insightsMap = {};
    try {
      const ir = await fetch(
        `${GRAPH}/${actId}/insights?fields=adset_id,spend,clicks,impressions,reach,cpc,ctr&level=adset&limit=200`,
        { headers },
      );
      const idata = await ir.json();
      for (const row of (idata.data || [])) insightsMap[row.adset_id] = row;
    } catch (_e) { /* insights optional */ }

    // Optimize a single campaign: rank its ACTIVE ad sets by cost-per-click,
    // boost the top performer's daily budget +20%, and pause clear losers
    // (CPC > 1.5× median) while always keeping the best two running.
    const optimize = async (cid, name) => {
      const asr = await fetch(
        `${GRAPH}/${cid}/adsets?fields=id,name,status,daily_budget,lifetime_budget&limit=200`,
        { headers },
      );
      const asd = await asr.json();
      if (asd.error) return { campaign: name, error: asd.error.message, actions: [] };

      const adsets = (asd.data || []).filter((a) => a.status === 'ACTIVE');
      const withData = adsets
        .map((a) => {
          const ins = insightsMap[a.id] || {};
          return {
            ...a,
            spend: parseFloat(ins.spend || '0'),
            cpc: parseFloat(ins.cpc || '0'),
            ctr: parseFloat(ins.ctr || '0'),
            clicks: parseInt(ins.clicks || '0', 10),
          };
        })
        .filter((a) => a.spend >= MIN_SPEND);

      if (withData.length < 3) {
        const summary = `Skipped — only ${withData.length} active ad set(s) with enough spend to judge (need ≥ $${MIN_SPEND} on at least 3).`;
        return { campaign: name, summary, actions: [] };
      }

      // Rank by CPC ascending (lower = more efficient); tiebreak by spend.
      withData.sort((a, b) => (a.cpc || 1e9) - (b.cpc || 1e9) || b.spend - a.spend);
      const medianCpc = withData[Math.floor(withData.length / 2)].cpc || 0;

      const actions = [];

      // 1. Boost the winner +20% (only when the ad set owns its own daily budget —
      //    CBO campaigns where budget lives on the campaign can't be boosted here).
      const top = withData[0];
      let boostedNote = '';
      if (top.daily_budget && parseFloat(top.daily_budget) > 0) {
        const newBudgetCents = Math.round(parseFloat(top.daily_budget) * 1.2);
        const r = await fetch(`${GRAPH}/${top.id}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ daily_budget: String(newBudgetCents) }),
        });
        const d = await r.json();
        if (d.error) {
          actions.push({ adset: top.name, action: 'boost', error: d.error.message });
        } else {
          actions.push({ adset: top.name, action: 'boost', new_budget: newBudgetCents / 100 });
          boostedNote = `Boosted "${top.name}" +20% to $${(newBudgetCents / 100).toFixed(2)}/day.`;
        }
      } else {
        boostedNote = `Top performer "${top.name}" uses campaign budget (CBO) — can't boost ad-set budget.`;
      }

      // 2. Pause clear losers, but always keep the best two active.
      const losers = withData
        .slice(2)
        .filter((a) => a.cpc > 0 && medianCpc > 0 && a.cpc > medianCpc * 1.5);
      for (const l of losers) {
        const r = await fetch(`${GRAPH}/${l.id}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'PAUSED' }),
        });
        const d = await r.json();
        if (d.error) actions.push({ adset: l.name, action: 'pause', error: d.error.message });
        else actions.push({ adset: l.name, action: 'pause', cpc: l.cpc });
      }

      const summary = `Ranked ${withData.length} active ad sets by cost-per-click. ${boostedNote} Paused ${losers.length} underperformer(s) (CPC > 1.5× median). Median CPC $${medianCpc.toFixed(2)}.`;
      return { campaign: name, summary, actions };
    };

    const nowIso = new Date().toISOString();
    const upsertRecord = async (cid, name, res) => {
      const existing = await base44.asServiceRole.entities.AutoOptimizer.filter({ campaign_id: String(cid) });
      const text = res.summary || res.error || '';
      const taken = (res.actions || []).length;
      if (existing.length) {
        await base44.asServiceRole.entities.AutoOptimizer.update(existing[0].id, {
          last_run_date: nowIso,
          last_run_summary: text,
          actions_taken: taken,
        });
      } else {
        await base44.asServiceRole.entities.AutoOptimizer.create({
          campaign_id: String(cid),
          campaign_name: name,
          enabled: false,
          last_run_date: nowIso,
          last_run_summary: text,
          actions_taken: taken,
        });
      }
    };

    const results = [];

    if (targetCampaignId) {
      // Manual "run now" for one campaign (runs regardless of enabled flag).
      const cr = await fetch(`${GRAPH}/${targetCampaignId}?fields=id,name`, { headers });
      const cd = await cr.json();
      const name = cd.name || targetCampaignId;
      const res = await optimize(targetCampaignId, name);
      await upsertRecord(targetCampaignId, name, res);
      results.push(res);
    } else {
      // Scheduled run: optimize every opted-in campaign.
      const records = (await base44.asServiceRole.entities.AutoOptimizer.filter({})).filter((r) => r.enabled);
      if (!records.length) return Response.json({ applied: 0, message: 'No enabled campaigns' });
      for (const rec of records) {
        const res = await optimize(rec.campaign_id, rec.campaign_name);
        await upsertRecord(rec.campaign_id, rec.campaign_name, res);
        results.push(res);
      }
    }

    return Response.json({ applied: results.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}