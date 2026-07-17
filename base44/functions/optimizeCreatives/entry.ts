import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const GRAPH = 'https://graph.facebook.com/v25.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Allow admin (manual) or workflow (no session).
    try {
      const u = await base44.auth.me();
      if (u && u.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    } catch (_e) { /* no user session (workflow) */ }

    const body = await req.json().catch(() => ({}));
    const auto_tune = body.auto_tune !== false;
    const generate = body.generate !== false;

    const configs = await base44.asServiceRole.entities.AppConfig.list();
    const config = configs[0];
    if (!config || !config.selected_ad_account_id) {
      return Response.json({ error: 'No ad account selected' }, { status: 400 });
    }
    const rawId = config.selected_ad_account_id;
    const actId = String(rawId).startsWith('act_') ? rawId : `act_${rawId}`;
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('meta_ads');
    const headers = { 'Authorization': `Bearer ${accessToken}` };

    // 1. Ads with creative + insights
    const ar = await fetch(`${GRAPH}/${actId}/ads?fields=id,name,status,adset_id,creative{id,thumbnail_url,object_story_spec,name}&limit=200`, { headers });
    const adata: any = await ar.json();
    if (adata.error) return Response.json({ error: adata.error.message }, { status: 502 });
    const ads: any[] = adata.data || [];
    if (!ads.length) return Response.json({ analyses: [], summary: 'No ads to analyze.', actions: [], generated: null, ads: [] });

    const insightsMap: Record<string, any> = {};
    try {
      const ir = await fetch(`${GRAPH}/${actId}/insights?fields=ad_id,spend,clicks,impressions,reach,cpc,ctr&level=ad&limit=200`, { headers });
      const idata: any = await ir.json();
      for (const row of (idata.data || [])) insightsMap[row.ad_id] = row;
    } catch (_e) { /* insights optional */ }

    const items = ads.map((a: any) => {
      const ins = insightsMap[a.id] || {};
      return {
        ad_id: a.id,
        name: a.name,
        status: a.status,
        adset_id: a.adset_id,
        creative_id: a.creative?.id,
        thumbnail: a.creative?.thumbnail_url || null,
        spend: ins.spend ? parseFloat(ins.spend) : 0,
        clicks: ins.clicks ? parseInt(ins.clicks) : 0,
        impressions: ins.impressions ? parseInt(ins.impressions) : 0,
        ctr: ins.ctr ? parseFloat(ins.ctr) : 0,
        cpc: ins.cpc ? parseFloat(ins.cpc) : 0,
      };
    });
    const file_urls = items.map((i: any) => i.thumbnail).filter(Boolean);

    const promptText =
      'You are a Facebook/Meta Ads creative performance analyst. For each ad (image provided where available), ' +
      'analyze the visual and its metrics to score it 0-100 and recommend an action. ' +
      'Actions: "keep" (fine), "pause" (poor — meaningful spend with low CTR / high CPC), "boost" (top performer worth more budget). ' +
      'For strong performers, set generate_variant=true and provide a concrete new_image_prompt for a better A/B test variation. ' +
      'Return analyses for every ad_id provided.\n\nAds:\n' +
      JSON.stringify(items.map((i: any) => ({ ad_id: i.ad_id, name: i.name, status: i.status, spend: i.spend, clicks: i.clicks, ctr: i.ctr, cpc: i.cpc })), null, 2);

    const schema = {
      type: 'object',
      properties: {
        analyses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ad_id: { type: 'string' },
              score: { type: 'number' },
              reason: { type: 'string' },
              action: { type: 'string', enum: ['keep', 'pause', 'boost'] },
              generate_variant: { type: 'boolean' },
              new_image_prompt: { type: 'string' },
            },
            required: ['ad_id', 'score', 'reason', 'action'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['analyses'],
    };

    const llmRes: any = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: promptText,
      file_urls: file_urls.length ? file_urls : undefined,
      response_json_schema: schema,
    });

    const analyses: any[] = (llmRes && llmRes.analyses) ? llmRes.analyses : [];
    const summary = (llmRes && llmRes.summary) || '';
    const actions: any[] = [];
    const itemMap: Record<string, any> = {};
    for (const it of items) itemMap[it.ad_id] = it;

    // 2. Auto-tune: pause losers, boost winners
    // Respect account spend cap: if reached, pause everything and skip boosts.
    let capHit = false;
    try {
      const sr = await fetch(`${GRAPH}/${actId}?fields=spend_cap,amount_spent`, { headers });
      const sd: any = await sr.json();
      const cap = sd.spend_cap ? parseInt(sd.spend_cap) : 0;
      const spent = sd.amount_spent ? parseInt(sd.amount_spent) : 0;
      if (cap > 0 && spent >= cap) {
        capHit = true;
        for (const it of items) {
          if (it.status === 'ACTIVE') {
            const r = await fetch(`${GRAPH}/${it.ad_id}`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'PAUSED' }),
            });
            const d: any = await r.json();
            actions.push({ ad_id: it.ad_id, action: 'paused (spend cap reached)', ok: !d.error, error: d.error?.message });
          }
        }
      }
    } catch (_e) { /* ignore spend read failure */ }

    if (auto_tune && !capHit) {
      for (const a of analyses) {
        const it = itemMap[a.ad_id];
        if (!it) continue;
        if (a.action === 'pause' && it.status === 'ACTIVE') {
          const r = await fetch(`${GRAPH}/${it.ad_id}`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'PAUSED' }),
          });
          const d: any = await r.json();
          actions.push({ ad_id: it.ad_id, action: 'paused', ok: !d.error, error: d.error?.message });
        } else if (a.action === 'boost' && it.adset_id) {
          const sr = await fetch(`${GRAPH}/${it.adset_id}?fields=daily_budget`, { headers });
          const sd: any = await sr.json();
          if (sd.daily_budget) {
            const newCents = Math.round(parseInt(sd.daily_budget) * 1.2);
            const r = await fetch(`${GRAPH}/${it.adset_id}`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ daily_budget: String(newCents) }),
            });
            const d: any = await r.json();
            actions.push({ ad_id: it.ad_id, action: 'boost', new_budget_cents: newCents, ok: !d.error, error: d.error?.message });
          }
        }
      }
    }

    // 3. Generate one new paused variant from the best performer
    let generated: any = null;
    if (generate) {
      const best = analyses
        .filter((a: any) => a.generate_variant && a.new_image_prompt && itemMap[a.ad_id]?.thumbnail)
        .sort((x: any, y: any) => (y.score || 0) - (x.score || 0))[0];
      if (best) {
        const it = itemMap[best.ad_id];
        try {
          const imgRes: any = await base44.asServiceRole.integrations.Core.GenerateImage({
            prompt: best.new_image_prompt,
            existing_image_urls: [it.thumbnail],
          });
          const imgUrl = imgRes?.url;
          if (imgUrl) {
            const imgResp = await fetch(imgUrl);
            const ab = await imgResp.arrayBuffer();
            const bytes = new Uint8Array(ab);
            const filename = 'aivariant.jpg';
            const boundary = 'b44opt' + Math.random().toString().slice(2);
            const head =
              `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="filename"\r\n\r\n${filename}\r\n` +
              `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="${filename}"; filename="${filename}"\r\n` +
              `Content-Type: image/jpeg\r\n\r\n`;
            const tail = `\r\n--${boundary}--\r\n`;
            const blob = new Blob([head, bytes, tail], { type: `multipart/form-data; boundary=${boundary}` });
            const ir2 = await fetch(`${GRAPH}/${actId}/adimages`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
              body: blob,
            });
            const idata2: any = await ir2.json();
            const image_hash = idata2?.images?.[filename]?.hash;
            if (image_hash && it.creative_id) {
              const cr3 = await fetch(`${GRAPH}/${it.creative_id}?fields=object_story_spec,name`, { headers });
              const cd3: any = await cr3.json();
              const spec: any = cd3.object_story_spec;
              if (spec) {
                if (spec.link_data) spec.link_data.image_hash = image_hash;
                const newCreative = { name: (it.name || 'Ad') + ' (AI variant)', object_story_spec: spec };
                const cr4 = await fetch(`${GRAPH}/${actId}/adcreatives`, {
                  method: 'POST',
                  headers: { ...headers, 'Content-Type': 'application/json' },
                  body: JSON.stringify(newCreative),
                });
                const cd4: any = await cr4.json();
                if (cd4.id) {
                  const ar3 = await fetch(`${GRAPH}/${actId}/ads`, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: (it.name || 'Ad') + ' (AI variant)', adset_id: it.adset_id, creative: { creative_id: cd4.id }, status: 'PAUSED' }),
                  });
                  const adData: any = await ar3.json();
                  generated = { from: it.ad_id, new_ad_id: adData.id, ok: !adData.error, error: adData.error?.message };
                }
              }
            }
          }
        } catch (e) {
          generated = { from: it.ad_id, error: (e as Error).message };
        }
      }
    }

    return Response.json({ analyses, summary, actions, generated, ads: items });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});