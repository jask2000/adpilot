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

    if (action === 'update_campaign') {
      const { campaign_id, name } = body;
      if (!campaign_id) return Response.json({ error: 'campaign_id required' }, { status: 400 });
      const updateBody: any = {};
      if (name != null) updateBody.name = name;
      const r = await fetch(`${GRAPH}/${campaign_id}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });
      const data = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true });
    }

    if (action === 'copy_campaign') {
      const { campaign_id } = body;
      if (!campaign_id) return Response.json({ error: 'campaign_id required' }, { status: 400 });
      const r = await fetch(`${GRAPH}/${campaign_id}/copies`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deep_copy: 'true',
          status_option: 'PAUSED',
          rename_options: { rename_strategy: 'ONLY_TOP_LEVEL_RENAME', rename_suffix: ' (copy)' },
        }),
      });
      const data = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true, copied_campaign_id: data.copied_campaign_id });
    }

    if (action === 'delete_campaign') {
      const { campaign_id } = body;
      if (!campaign_id) return Response.json({ error: 'campaign_id required' }, { status: 400 });
      const r = await fetch(`${GRAPH}/${campaign_id}`, { method: 'DELETE', headers });
      const data = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true });
    }

    if (action === 'create_ad') {
      const {
        account_id, campaign_name, objective, daily_budget, ad_name,
        message, link, headline, image_base64, image_filename, call_to_action_type,
      } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;

      const opt = objective || 'OUTCOME_TRAFFIC';
      const optGoalMap: Record<string, string> = {
        OUTCOME_AWARENESS: 'REACH',
        OUTCOME_TRAFFIC: 'LINK_CLICKS',
        OUTCOME_ENGAGEMENT: 'POST_ENGAGEMENT',
        OUTCOME_SALES: 'OFFSITE_CONVERSIONS',
      };
      const optimization_goal = optGoalMap[opt] || 'LINK_CLICKS';

      // 1. Campaign
      const cr = await fetch(`${GRAPH}/${actId}/campaigns`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: campaign_name || 'New Campaign', objective: opt, status: 'PAUSED', buying_type: 'AUCTION' }),
      });
      const cd = await cr.json();
      if (cd.error) return Response.json({ error: 'campaign: ' + cd.error.message }, { status: 502 });
      const campaign_id = cd.id;

      // 2. Ad set
      const budgetCents = Math.round(Number(daily_budget || 0) * 100);
      const ar = await fetch(`${GRAPH}/${actId}/adsets`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: (campaign_name || 'Ad Set'),
          campaign_id,
          daily_budget: String(budgetCents),
          billing_event: 'IMPRESSIONS',
          optimization_goal,
          targeting: { geo_locations: { countries: ['US', 'CA'] } },
          status: 'PAUSED',
        }),
      });
      const adset = await ar.json();
      if (adset.error) return Response.json({ error: 'adset: ' + adset.error.message, campaign_id }, { status: 502 });
      const adset_id = adset.id;

      // 3. Upload image
      let image_hash: string | null = null;
      if (image_base64) {
        try {
          const b64 = String(image_base64).split(',').pop() || '';
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const filename = image_filename || 'adimage.jpg';
          const boundary = 'b44boundary' + Math.random().toString().slice(2);
          const head =
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="filename"\r\n\r\n${filename}\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${filename}"; filename="${filename}"\r\n` +
            `Content-Type: image/jpeg\r\n\r\n`;
          const tail = `\r\n--${boundary}--\r\n`;
          const blob = new Blob([head, bytes, tail], { type: `multipart/form-data; boundary=${boundary}` });
          const ir = await fetch(`${GRAPH}/${actId}/adimages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            body: blob,
          });
          const idata: any = await ir.json();
          if (idata.error) return Response.json({ error: 'image: ' + idata.error.message, campaign_id, adset_id }, { status: 502 });
          image_hash = idata?.images?.[filename]?.hash || null;
        } catch (e) {
          return Response.json({ error: 'image upload failed: ' + (e as Error).message, campaign_id, adset_id }, { status: 502 });
        }
      }

      // 4. Page id
      let page_id = body.page_id;
      if (!page_id) {
        const pr = await fetch(`${GRAPH}/me/accounts?fields=id,name&limit=10`, { headers });
        const pdata: any = await pr.json();
        if (pdata.data && pdata.data.length) page_id = pdata.data[0].id;
      }
      if (!page_id) return Response.json({ error: 'No Facebook Page connected to your account. Connect a Page to publish ads.', campaign_id, adset_id }, { status: 400 });

      // 5. Ad creative
      const linkData: any = { message: message || '' };
      if (link) linkData.link = link;
      if (headline) linkData.name = headline;
      if (image_hash) linkData.image_hash = image_hash;
      if (call_to_action_type) linkData.call_to_action = { type: call_to_action_type, value: link ? { link } : {} };
      const creativeFields = {
        name: ad_name || 'Ad Creative',
        object_story_spec: { page_id, link_data: linkData },
      };
      const cr2 = await fetch(`${GRAPH}/${actId}/adcreatives`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(creativeFields),
      });
      const cd2: any = await cr2.json();
      if (cd2.error) return Response.json({ error: 'creative: ' + cd2.error.message, campaign_id, adset_id }, { status: 502 });
      const creative_id = cd2.id;

      // 6. Ad
      const ar2 = await fetch(`${GRAPH}/${actId}/ads`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ad_name || 'Ad', adset_id, creative: { creative_id }, status: 'PAUSED' }),
      });
      const adData: any = await ar2.json();
      if (adData.error) return Response.json({ error: 'ad: ' + adData.error.message, campaign_id, adset_id, creative_id }, { status: 502 });

      return Response.json({ success: true, campaign_id, adset_id, creative_id, ad_id: adData.id });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});