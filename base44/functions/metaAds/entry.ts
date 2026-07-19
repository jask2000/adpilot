import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const GRAPH = 'https://graph.facebook.com/v25.0';
const BYO_META_CONNECTOR_ID = '6a5c2d983698e0e0426de0b5';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('meta_ads');
    const headers = { 'Authorization': `Bearer ${accessToken}` };

    if (action === 'byo_status') {
      try {
        await base44.asServiceRole.connectors.getCurrentAppUserConnection(BYO_META_CONNECTOR_ID);
        return Response.json({ connected: true });
      } catch (_e) {
        return Response.json({ connected: false });
      }
    }

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

      const campaigns = (cdata.data || [])
        .filter((c: any) => c.status !== 'ARCHIVED' && c.effective_status !== 'ARCHIVED')
        .map((c: any) => ({ ...c, insights: insightsMap[c.id] || null }));
      return Response.json({ campaigns });
    }

    if (action === 'delete_ad') {
      const { ad_id } = body;
      if (!ad_id) return Response.json({ error: 'ad_id required' }, { status: 400 });
      // Ads that have run can't be hard-deleted; archive first then tolerate a delete failure.
      let archived = false;
      try {
        const ar = await fetch(`${GRAPH}/${ad_id}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ARCHIVED' }),
        });
        const ad: any = await ar.json();
        archived = !ad.error;
      } catch (_e) { /* try delete anyway */ }
      let errMsg: string | null = null;
      let deleted = false;
      try {
        const r = await fetch(`${GRAPH}/${ad_id}`, { method: 'DELETE', headers });
        const data: any = await r.json();
        if (data.error) errMsg = data.error.message;
        else deleted = true;
      } catch (e) { errMsg = (e as Error).message; }
      if (deleted) return Response.json({ success: true, action: 'deleted' });
      if (archived) return Response.json({ success: true, action: 'archived' });
      return Response.json({ error: errMsg || 'Delete failed' }, { status: 502 });
    }

    if (action === 'update_ad_status') {
      const { ad_id, status } = body;
      if (!ad_id || !status) return Response.json({ error: 'ad_id and status required' }, { status: 400 });
      const r = await fetch(`${GRAPH}/${ad_id}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true });
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
      // Meta rarely hard-deletes campaigns that have already run (they return
      // "campaign cannot be deleted" errors). Archive it first — archived
      // campaigns disappear from the dashboard — then attempt the hard delete
      // and tolerate failure since the archive is the real "remove" here.
      let archived = false;
      try {
        const ar = await fetch(`${GRAPH}/${campaign_id}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ARCHIVED' }),
        });
        const ad: any = await ar.json();
        archived = !ad.error;
      } catch (_e) { /* ignore — try delete anyway */ }

      let errMsg: string | null = null;
      let deleted = false;
      try {
        const r = await fetch(`${GRAPH}/${campaign_id}`, { method: 'DELETE', headers });
        const data: any = await r.json();
        if (data.error) errMsg = data.error.message;
        else deleted = true;
      } catch (e) { errMsg = (e as Error).message; }

      if (deleted) return Response.json({ success: true, action: 'deleted' });
      if (archived) return Response.json({ success: true, action: 'archived' });
      return Response.json({ error: errMsg || 'Delete failed' }, { status: 502 });
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

      // For Sales campaigns, auto-attach the account's conversion pixel so the
      // ad set can optimize for purchases without manual setup.
      let promoted_object: any = null;
      if (opt === 'OUTCOME_SALES') {
        const pxr = await fetch(`${GRAPH}/${actId}/adspixels?fields=id,name&limit=10`, { headers });
        const pxd: any = await pxr.json();
        if (!pxd.error && pxd.data && pxd.data.length) {
          promoted_object = { pixel_id: pxd.data[0].id, custom_event_type: 'PURCHASE' };
        }
      }

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
      let targeting: any = { geo_locations: { countries: ['US', 'CA'] } };
      if (Array.isArray(body.locations) && body.locations.length) {
        // Build geo-targeting from each store's full address: geocode to lat/lng,
        // then target a 4-mile radius around that exact address.
        const custom_locations: any[] = [];
        for (const loc of body.locations) {
          const addr = [loc.address, loc.city, loc.province, loc.postal_code, loc.country || 'Canada']
            .filter(Boolean).join(', ');
          if (!addr) continue;
          try {
            const gres = await fetch(
              `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`,
              { headers: { 'User-Agent': 'AdPilot/1.0 (hellcrust-ads)' } },
            );
            const gdata: any = await gres.json();
            if (gdata && gdata[0]) {
              custom_locations.push({
                latitude: gdata[0].lat,
                longitude: gdata[0].lon,
                radius: loc.radius || 4,
                distance_unit: 'mile',
              });
            }
          } catch (_e) { /* skip unresolved address */ }
        }
        if (custom_locations.length) targeting = { geo_locations: { custom_locations } };
      } else if (body.audience_id) {
        if (body.audience_kind === 'saved') {
          const tr = await fetch(`${GRAPH}/${body.audience_id}?fields=targeting`, { headers });
          const td: any = await tr.json();
          if (!td.error && td.targeting) targeting = td.targeting;
        } else {
          targeting = { custom_audiences: [{ id: body.audience_id }] };
        }
      }
      const ar = await fetch(`${GRAPH}/${actId}/adsets`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: (campaign_name || 'Ad Set'),
          campaign_id,
          daily_budget: String(budgetCents),
          billing_event: 'IMPRESSIONS',
          optimization_goal,
          targeting,
          ...(promoted_object ? { promoted_object } : {}),
          status: 'PAUSED',
        }),
      });
      const adset = await ar.json();
      if (adset.error) return Response.json({ error: 'adset: ' + adset.error.message, campaign_id }, { status: 502 });
      const adset_id = adset.id;

      // 3. Use existing image or upload a new one
      let image_hash: string | null = body.image_hash || null;
      if (!image_hash && image_base64) {
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

    if (action === 'list_audiences') {
      const { account_id } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const [cr, sr] = await Promise.all([
        fetch(`${GRAPH}/${actId}/customaudiences?fields=id,name,subtype,approximate_count,description,status,time_updated&limit=200`, { headers }),
        fetch(`${GRAPH}/${actId}/saved_audiences?fields=id,name,description,status,time_updated&limit=200`, { headers }),
      ]);
      const cdata: any = await cr.json();
      if (cdata.error) return Response.json({ error: cdata.error.message }, { status: 502 });
      const sdata: any = await sr.json().catch(() => ({}));
      const custom = (cdata.data || []).map((a: any) => ({ ...a, kind: 'custom' }));
      const saved = ((sdata && sdata.data) || []).map((a: any) => ({ ...a, subtype: 'SAVED', kind: 'saved' }));
      return Response.json({ audiences: [...custom, ...saved] });
    }

    if (action === 'create_audience') {
      const { account_id, name, description } = body;
      if (!account_id || !name) return Response.json({ error: 'account_id and name required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const r = await fetch(`${GRAPH}/${actId}/customaudiences`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, subtype: 'CUSTOM_AUDIENCE', description: description || '', customer_file_source: 'USER_PROVIDED_ONLY' }),
      });
      const data: any = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true, audience_id: data.id });
    }

    if (action === 'create_lookalike') {
      const { account_id, origin_audience_id, name, country, ratio } = body;
      if (!account_id || !origin_audience_id) return Response.json({ error: 'account_id and origin_audience_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const r = await fetch(`${GRAPH}/${actId}/customaudiences`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Lookalike',
          subtype: 'LOOKALIKE',
          origin_audience_id,
          lookalike_spec: { country: country || 'CA', ratio: ratio || 0.01, start: ratio || 0.01, end: ratio || 0.01 },
        }),
      });
      const data: any = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true, audience_id: data.id });
    }

    if (action === 'list_ads') {
      const { account_id } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const ar = await fetch(`${GRAPH}/${actId}/ads?fields=id,name,status,adset_id,creative{id,thumbnail_url,name}&limit=200`, { headers });
      const adata: any = await ar.json();
      if (adata.error) return Response.json({ error: adata.error.message }, { status: 502 });
      const ads = adata.data || [];
      const insightsMap: Record<string, any> = {};
      try {
        const ir = await fetch(`${GRAPH}/${actId}/insights?fields=ad_id,spend,clicks,impressions,reach,cpc,ctr&level=ad&limit=200`, { headers });
        const idata: any = await ir.json();
        for (const row of (idata.data || [])) insightsMap[row.ad_id] = row;
      } catch (_e) { /* insights optional */ }
      const result = ads.map((a: any) => ({ ...a, insights: insightsMap[a.id] || null, thumbnail: a.creative?.thumbnail_url || null }));
      return Response.json({ ads: result });
    }

    if (action === 'get_spend') {
      const { account_id } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const r = await fetch(`${GRAPH}/${actId}?fields=spend_cap,amount_spent,currency,balance`, { headers });
      const data: any = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({
        spend_cap: data.spend_cap || 0,
        amount_spent: data.amount_spent || 0,
        currency: data.currency || 'USD',
        balance: data.balance || 0,
      });
    }

    if (action === 'set_spend_cap') {
      const { account_id, cap } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      // Meta's spend_cap is accepted in the account currency (dollars) and stored as cents,
      // so we send the dollar value as-is (no ×100 conversion).
      const r = await fetch(`${GRAPH}/${actId}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ spend_cap: Math.round(Number(cap) * 100) / 100 }),
      });
      const data: any = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true });
    }

    if (action === 'list_used_image_hashes') {
      const { account_id } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      // 1. Find currently ACTIVE ads and their creative ids.
      const hashes = new Set<string>();
      const creativeIds = new Set<string>();
      let url: string | null = `${GRAPH}/${actId}/ads?fields=id,effective_status,creative{id}&limit=200&effective_status=["ACTIVE"]`;
      let guard = 0;
      while (url && guard < 10) {
        guard++;
        const r = await fetch(url, { headers });
        const data: any = await r.json();
        if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
        for (const ad of (data.data || [])) {
          if (ad.creative?.id) creativeIds.add(ad.creative.id);
        }
        url = data.paging && data.paging.next ? data.paging.next : null;
      }
      // 2. Fetch each creative's object_story_spec and pull out image hashes.
      for (const cid of Array.from(creativeIds)) {
        try {
          const r = await fetch(`${GRAPH}/${cid}?fields=object_story_spec`, { headers });
          const data: any = await r.json();
          if (data.error) continue;
          const json = JSON.stringify(data.object_story_spec || {});
          const matches = json.match(/"image_hash":"([^"]+)"/g) || [];
          for (const mm of matches) hashes.add(mm.match(/"image_hash":"([^"]+)"/)![1]);
        } catch (_e) { /* skip */ }
      }
      return Response.json({ hashes: Array.from(hashes), active_ads: creativeIds.size });
    }

    if (action === 'list_creative_hashes') {
      const { account_id } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      // Map image_hash -> list of creative ids that reference it (across ALL creatives, any ad status).
      const map: Record<string, string[]> = {};
      let url: string | null = `${GRAPH}/${actId}/adcreatives?fields=id,object_story_spec&limit=200`;
      let guard = 0;
      while (url && guard < 10) {
        guard++;
        const r = await fetch(url, { headers });
        const data: any = await r.json();
        if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
        for (const c of (data.data || [])) {
          const json = JSON.stringify(c.object_story_spec || {});
          const matches = json.match(/"image_hash":"([^"]+)"/g) || [];
          for (const mm of matches) {
            const h = mm.match(/"image_hash":"([^"]+)"/)![1];
            if (!map[h]) map[h] = [];
            if (!map[h].includes(c.id)) map[h].push(c.id);
          }
        }
        url = data.paging && data.paging.next ? data.paging.next : null;
      }
      const target = body.hash;
      if (target) return Response.json({ hash: target, creatives: map[target] || [], referenced: !!(map[target] && map[target].length) });
      return Response.json({ map, count: Object.keys(map).length });
    }

    if (action === 'delete_creative') {
      const { creative_id } = body;
      if (!creative_id) return Response.json({ error: 'creative_id required' }, { status: 400 });
      const r = await fetch(`${GRAPH}/${creative_id}`, { method: 'DELETE', headers });
      const data: any = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true });
    }

    if (action === 'list_media') {
      const { account_id } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const r = await fetch(`${GRAPH}/${actId}/adimages?fields=id,name,hash,url,width,height,created_time&limit=200`, { headers });
      const data: any = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ media: data.data || [] });
    }

    // -- helpers shared by delete actions --
    const collectCreativeMap = async (actId: string) => {
      // Map image_hash -> creative ids referencing it (ALL creatives, any ad status).
      const map: Record<string, string[]> = {};
      let url: string | null = `${GRAPH}/${actId}/adcreatives?fields=id,object_story_spec&limit=200`;
      let guard = 0;
      while (url && guard < 10) {
        guard++;
        const r = await fetch(url, { headers });
        const data: any = await r.json();
        if (data.error) throw new Error(data.error.message);
        for (const c of (data.data || [])) {
          const json = JSON.stringify(c.object_story_spec || {});
          const matches = json.match(/"image_hash":"([^"]+)"/g) || [];
          for (const mm of matches) {
            const h = mm.match(/"image_hash":"([^"]+)"/)![1];
            if (!map[h]) map[h] = [];
            if (!map[h].includes(c.id)) map[h].push(c.id);
          }
        }
        url = data.paging && data.paging.next ? data.paging.next : null;
      }
      return map;
    };

    // Map creative_id -> [{ id, effective_status }] for every ad in the account.
    const collectAdMap = async (actId: string) => {
      const map: Record<string, Array<{ id: string; effective_status: string }>> = {};
      let url: string | null = `${GRAPH}/${actId}/ads?fields=id,effective_status,creative{id}&limit=200`;
      let guard = 0;
      while (url && guard < 10) {
        guard++;
        const r = await fetch(url, { headers });
        const data: any = await r.json();
        if (data.error) throw new Error(data.error.message);
        for (const ad of (data.data || [])) {
          if (ad.creative?.id) {
            if (!map[ad.creative.id]) map[ad.creative.id] = [];
            map[ad.creative.id].push({ id: ad.id, effective_status: ad.effective_status || 'UNKNOWN' });
          }
        }
        url = data.paging && data.paging.next ? data.paging.next : null;
      }
      return map;
    };

    const deleteImageByHash = async (actId: string, hash: string) => {
      const r = await fetch(`${GRAPH}/${actId}/adimages?hash=${encodeURIComponent(hash)}`, { method: 'DELETE', headers });
      const data: any = await r.json();
      if (data.error) throw new Error(data.error.message || 'Delete failed');
      return true;
    };

    if (action === 'delete_media') {
      const { account_id, hashes, hash } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const targetHashes: string[] = Array.isArray(hashes) ? hashes : (hash ? [hash] : []);
      if (!targetHashes.length) return Response.json({ error: 'hash or hashes required' }, { status: 400 });

      try {
        const [creativeMap, adMap] = await Promise.all([collectCreativeMap(actId), collectAdMap(actId)]);

        // For each target image: split its creatives into "keep" (used by an active ad) and
        // "remove" (everything else). To remove a creative, Meta first needs the ads that use
        // it deleted — so we delete any non-active ads attached to those creatives first.
        const perHash = targetHashes.map((h) => {
          const creatives = creativeMap[h] || [];
          const keep: string[] = [];
          const remove: string[] = [];
          const adsToDelete = new Set<string>();
          for (const cid of creatives) {
            const ads = adMap[cid] || [];
            if (ads.some((a) => a.effective_status === 'ACTIVE')) {
              keep.push(cid);
            } else {
              remove.push(cid);
              for (const a of ads) adsToDelete.add(a.id);
            }
          }
          return { hash: h, keep, remove, adsToDelete };
        });

        // 1. Delete every non-active ad that blocks a creative we want to remove (parallel).
        const adsToDelete = new Set<string>();
        for (const p of perHash) for (const id of p.adsToDelete) adsToDelete.add(id);
        await Promise.all(Array.from(adsToDelete).map(async (aid) => {
          try { await fetch(`${GRAPH}/${aid}`, { method: 'DELETE', headers }); } catch (_e) {}
        }));

        // 2. Now delete the creatives themselves (parallel). Active-ad creatives are left untouched.
        const creativesToDelete = new Set<string>();
        for (const p of perHash) for (const c of p.remove) creativesToDelete.add(c);
        await Promise.all(Array.from(creativesToDelete).map(async (cid) => {
          try { await fetch(`${GRAPH}/${cid}`, { method: 'DELETE', headers }); } catch (_e) {}
        }));

        // 3. Give Meta a moment to propagate before images unlock.
        if (creativesToDelete.size) await new Promise((res) => setTimeout(res, 2500));

        // 4. Delete each image, retrying if Meta still thinks it's locked.
        const results = await Promise.all(perHash.map(async (p) => {
          if (p.keep.length) return { hash: p.hash, status: 'blocked', reason: 'Used by an active ad — cannot delete.', creatives_removed: p.remove.length };
          let lastErr = '';
          let deleted = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await new Promise((res) => setTimeout(res, 2000));
            try { await deleteImageByHash(actId, p.hash); deleted = true; break; }
            catch (e) { lastErr = (e as Error).message; if (p.remove.length === 0) break; }
          }
          if (deleted) return { hash: p.hash, status: 'deleted', creatives_removed: p.remove.length };
          return { hash: p.hash, status: 'error', reason: lastErr, creatives_removed: p.remove.length };
        }));

        // 5. For any image that failed despite removing creatives, re-scan once to report which
        //    creatives Meta refused to release (so the UI can say why, not just "Invalid parameter").
        const failedHashes = results.filter((r) => r.status === 'error' && perHash.find((p) => p.hash === r.hash)?.remove.length > 0).map((r) => r.hash);
        if (failedHashes.length) {
          const remaining = await collectCreativeMap(actId);
          for (const r of results) {
            if (r.status === 'error' && failedHashes.includes(r.hash)) {
              const count = (remaining[r.hash] || []).length;
              if (count > 0) r.reason = `Meta won't release this image — ${count} creative(s) referencing it can't be deleted (previously used in ads).`;
            }
          }
        }

        const failed = results.filter((r) => r.status !== 'deleted');
        return Response.json({
          success: failed.length === 0,
          results,
          deleted: results.filter((r) => r.status === 'deleted').length,
          blocked: results.filter((r) => r.status === 'blocked').length,
          errors: results.filter((r) => r.status === 'error').length,
        }, { status: failed.length === 0 ? 200 : 502 });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 502 });
      }
    }

    if (action === 'upload_media') {
      const { account_id, image_base64, image_filename } = body;
      if (!account_id || !image_base64) return Response.json({ error: 'account_id and image_base64 required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      try {
        const b64 = String(image_base64).split(',').pop() || '';
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const filename = image_filename || `upload_${Date.now()}.jpg`;
        const boundary = 'b44boundary' + Math.random().toString().slice(2);
        const head =
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="filename"\r\n\r\n${filename}\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${filename}"; filename="${filename}"\r\n` +
          `Content-Type: image/jpeg\r\n\r\n`;
        const tail = `\r\n--${boundary}--\r\n`;
        const blob = new Blob([head, bytes, tail], { type: `multipart/form-data; boundary=${boundary}` });
        const r = await fetch(`${GRAPH}/${actId}/adimages`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: blob,
        });
        const data: any = await r.json();
        if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
        const hash = data?.images?.[filename]?.hash || null;
        return Response.json({ success: true, hash, filename });
      } catch (e) {
        return Response.json({ error: 'image upload failed: ' + (e as Error).message }, { status: 502 });
      }
    }

    if (action === 'upload_video') {
      const { account_id, video_base64, video_filename, title } = body;
      if (!account_id || !video_base64) return Response.json({ error: 'account_id and video_base64 required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      try {
        const b64 = String(video_base64).split(',').pop() || '';
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const filename = video_filename || `upload_${Date.now()}.mp4`;
        const boundary = 'b44vid' + Math.random().toString().slice(2);
        const head =
          `--${boundary}\r\n` +
          (title ? `Content-Disposition: form-data; name="title"\r\n\r\n${title}\r\n--${boundary}\r\n` : '') +
          `Content-Disposition: form-data; name="source"; filename="${filename}"\r\n` +
          `Content-Type: video/mp4\r\n\r\n`;
        const tail = `\r\n--${boundary}--\r\n`;
        const blob = new Blob([head, bytes, tail], { type: `multipart/form-data; boundary=${boundary}` });
        const r = await fetch(`${GRAPH}/${actId}/advideos`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: blob,
        });
        const data: any = await r.json();
        if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
        return Response.json({ success: true, video_id: data.id });
      } catch (e) {
        return Response.json({ error: 'video upload failed: ' + (e as Error).message }, { status: 502 });
      }
    }

    if (action === 'list_videos') {
      const { account_id } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const r = await fetch(`${GRAPH}/${actId}/advideos?fields=id,name,title,length,thumbnail_url,created_time&limit=200`, { headers });
      const data: any = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ videos: data.data || [] });
    }

    if (action === 'replace_creative') {
      const { account_id, ad_id, image_base64, image_filename, video_base64, video_filename, headline, message, link } = body;
      if (!account_id || !ad_id) return Response.json({ error: 'account_id and ad_id required' }, { status: 400 });
      if (!image_base64 && !video_base64) return Response.json({ error: 'image_base64 or video_base64 required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;

      // 1. Current ad: status + creative id
      const adRes = await fetch(`${GRAPH}/${ad_id}?fields=id,name,status,adset_id,creative{id}`, { headers });
      const adData: any = await adRes.json();
      if (adData.error) return Response.json({ error: adData.error.message }, { status: 502 });
      const oldCreativeId = adData.creative?.id;
      const wasActive = adData.status === 'ACTIVE';

      // 2. Clone the existing creative's object_story_spec (page_id, link, CTA...)
      let baseSpec: any = {};
      let creativeLinkUrl: string | null = null;
      let creativeCta: any = null;
      if (oldCreativeId) {
        const cr = await fetch(`${GRAPH}/${oldCreativeId}?fields=object_story_spec,link_url,call_to_action`, { headers });
        const cd: any = await cr.json();
        if (!cd.error) {
          baseSpec = cd.object_story_spec || {};
          creativeLinkUrl = cd.link_url || null;
          creativeCta = cd.call_to_action || null;
        }
      }
      let page_id = baseSpec.page_id;
      if (!page_id) {
        const pr = await fetch(`${GRAPH}/me/accounts?fields=id&limit=1`, { headers });
        const pd: any = await pr.json();
        page_id = pd.data?.[0]?.id;
      }
      if (!page_id) return Response.json({ error: 'No Facebook Page connected to your account.' }, { status: 400 });

      // 3. Upload replacement image or video
      let image_hash: string | null = null;
      let video_id: string | null = null;
      try {
        if (image_base64) {
          const b64 = String(image_base64).split(',').pop() || '';
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const filename = image_filename || `replace_${Date.now()}.jpg`;
          const boundary = 'b44rep' + Math.random().toString().slice(2);
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
          if (idata.error) return Response.json({ error: 'image: ' + idata.error.message }, { status: 502 });
          image_hash = idata?.images?.[filename]?.hash || null;
        } else {
          const b64 = String(video_base64).split(',').pop() || '';
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const filename = video_filename || `replace_${Date.now()}.mp4`;
          const boundary = 'b44repv' + Math.random().toString().slice(2);
          const head =
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="source"; filename="${filename}"\r\n` +
            `Content-Type: video/mp4\r\n\r\n`;
          const tail = `\r\n--${boundary}--\r\n`;
          const blob = new Blob([head, bytes, tail], { type: `multipart/form-data; boundary=${boundary}` });
          const vr = await fetch(`${GRAPH}/${actId}/advideos`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            body: blob,
          });
          const vdata: any = await vr.json();
          if (vdata.error) return Response.json({ error: 'video: ' + vdata.error.message }, { status: 502 });
          video_id = vdata.id || null;
        }
      } catch (e) {
        return Response.json({ error: 'upload failed: ' + (e as Error).message }, { status: 502 });
      }

      // 4. Build the new creative spec (clone original, swap media + optional copy)
      let newSpec: any;
      if (image_hash) {
        const linkData = baseSpec.link_data ? JSON.parse(JSON.stringify(baseSpec.link_data)) : {};
        // Meta rejects a creative that carries the old image's hosted URL/crops
        // alongside a new image_hash ("invalid parameter"). Drop the stale fields.
        delete linkData.image_url;
        delete linkData.image_crops;
        delete linkData.url_tags;
        linkData.image_hash = image_hash;
        if (message) linkData.message = message;
        if (headline) linkData.name = headline;
        // link_data.link is required for traffic/link ads. If the original was a
        // video creative (no link_data) the link may live in video_data or the
        // call_to_action value — pull it across so Meta accepts the new creative.
        if (link) linkData.link = link;
        if (!linkData.link) {
          const ctaLink = (linkData.call_to_action || baseSpec.video_data?.call_to_action)?.value?.link
            || baseSpec.video_data?.link
            || creativeCta?.value?.link
            || creativeLinkUrl;
          if (ctaLink) linkData.link = ctaLink;
        }
        if (!linkData.call_to_action) {
          linkData.call_to_action = baseSpec.video_data?.call_to_action || creativeCta || undefined;
        }
        if (!linkData.link) return Response.json({ error: 'This ad has no destination link to reuse. Enter a "Link" for the replacement creative.' }, { status: 400 });
        newSpec = { page_id, link_data: linkData };
      } else {
        const videoData: any = { video_id };
        if (message) videoData.message = message;
        if (headline) videoData.title = headline;
        newSpec = { page_id, video_data: videoData };
      }

      // 5. Create the replacement creative
      const crRes = await fetch(`${GRAPH}/${actId}/adcreatives`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: (adData.name || 'Ad') + ' (replaced)', object_story_spec: newSpec }),
      });
      const crData: any = await crRes.json();
      if (crData.error) {
        const e = crData.error;
        const detail = [e.message, e.error_subcode ? `subcode ${e.error_subcode}` : '', e.error_user_msg, e.error_user_title].filter(Boolean).join(' · ');
        return Response.json({ error: 'creative: ' + detail, sent_spec: newSpec }, { status: 502 });
      }

      // 6. Point the existing ad at the new creative. Meta won't update a creative
      //    on an ACTIVE ad, so pause first and resume afterward if it was active.
      if (wasActive) {
        await fetch(`${GRAPH}/${ad_id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'PAUSED' }) });
      }
      const upRes = await fetch(`${GRAPH}/${ad_id}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ creative: { creative_id: crData.id } }),
      });
      const upData: any = await upRes.json();
      if (upData.error) {
        if (wasActive) await fetch(`${GRAPH}/${ad_id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }) });
        return Response.json({ error: 'ad update: ' + upData.error.message, new_creative_id: crData.id }, { status: 502 });
      }
      if (wasActive) {
        await fetch(`${GRAPH}/${ad_id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }) });
      }

      return Response.json({ success: true, ad_id, new_creative_id: crData.id, was_active: wasActive });
    }

    if (action === 'add_variants') {
      const { account_id, campaign_id, variant_images, headline, message, status } = body;
      if (!account_id || !campaign_id) return Response.json({ error: 'account_id and campaign_id required' }, { status: 400 });
      const imgs: string[] = Array.isArray(variant_images) ? variant_images.filter(Boolean) : [];
      if (!imgs.length) return Response.json({ error: 'variant_images required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const targetStatus = status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED';

      // 1. Ad sets of the campaign — prefer an ACTIVE one, else the first.
      const asr = await fetch(`${GRAPH}/${campaign_id}/adsets?fields=id,name,status&limit=100`, { headers });
      const asd: any = await asr.json();
      if (asd.error) return Response.json({ error: 'adsets: ' + asd.error.message }, { status: 502 });
      const adsets: any[] = asd.data || [];
      if (!adsets.length) return Response.json({ error: 'This campaign has no ad sets to add variants to.' }, { status: 400 });
      const adset = adsets.find((a) => a.status === 'ACTIVE') || adsets[0];

      // 2. Find an existing ad in that ad set to clone the creative spec from.
      const adr = await fetch(`${GRAPH}/${adset.id}/ads?fields=id,name,creative{id}&limit=100`, { headers });
      const add: any = await adr.json();
      if (add.error) return Response.json({ error: 'ads: ' + add.error.message }, { status: 502 });
      const templateAd = (add.data || []).find((a: any) => a.creative?.id) || null;
      let baseSpec: any = null;
      if (templateAd?.creative?.id) {
        const cr = await fetch(`${GRAPH}/${templateAd.creative.id}?fields=object_story_spec`, { headers });
        const cd: any = await cr.json();
        if (!cd.error) baseSpec = cd.object_story_spec || null;
      }
      let page_id = baseSpec?.page_id;
      if (!page_id) {
        const pr = await fetch(`${GRAPH}/me/accounts?fields=id&limit=1`, { headers });
        const pd: any = await pr.json();
        page_id = pd.data?.[0]?.id;
      }
      if (!page_id) return Response.json({ error: 'No Facebook Page connected to your account.' }, { status: 400 });
      if (!baseSpec) baseSpec = { page_id, link_data: {} };

      // 3. Upload each image, build a cloned creative, create a new ad under the ad set.
      const uploadB64 = async (dataUrl: string, filename: string): Promise<string | null> => {
        const b64 = String(dataUrl).split(',').pop() || '';
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const boundary = 'b44var' + Math.random().toString().slice(2);
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
        const d: any = await ir.json();
        return d?.images?.[filename]?.hash || null;
      };

      const variants: any[] = [];
      for (let i = 0; i < imgs.length; i++) {
        const hash = await uploadB64(imgs[i], `variant_${i + 1}.jpg`);
        if (!hash) { variants.push({ ok: false, error: 'image upload failed', index: i }); continue; }
        const linkData = baseSpec.link_data ? JSON.parse(JSON.stringify(baseSpec.link_data)) : {};
        linkData.image_hash = hash;
        if (message) linkData.message = message;
        if (headline) linkData.name = headline;
        const spec = { page_id, link_data: linkData };
        const label = (templateAd?.name || adset.name || 'Variant') + (imgs.length > 1 ? ` (variant ${i + 1})` : ' (variant)');
        const cr4 = await fetch(`${GRAPH}/${actId}/adcreatives`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: label, object_story_spec: spec }),
        });
        const cd4: any = await cr4.json();
        if (cd4.error) { variants.push({ ok: false, error: cd4.error.message, index: i }); continue; }
        const ar3 = await fetch(`${GRAPH}/${actId}/ads`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: label, adset_id: adset.id, creative: { creative_id: cd4.id }, status: targetStatus }),
        });
        const adData: any = await ar3.json();
        variants.push({ new_ad_id: adData.id, ok: !adData.error, error: adData.error?.message, index: i, status: targetStatus });
      }

      const okCount = variants.filter((v) => v.ok).length;
      if (!okCount) return Response.json({ error: 'No variants could be created.', variants }, { status: 502 });
      return Response.json({ success: true, created: okCount, total: variants.length, variants, adset_id: adset.id, status: targetStatus });
    }

    if (action === 'replace_creative_multi') {
      const { account_id, ad_id, assets, headline, message, link } = body;
      if (!account_id || !ad_id) return Response.json({ error: 'account_id and ad_id required' }, { status: 400 });
      const list: any[] = Array.isArray(assets) ? assets.filter((a) => a && (a.image_url || a.video_url || a.image_base64 || a.video_base64)) : [];
      if (!list.length) return Response.json({ error: 'assets required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;

      // Source ad: status + creative id (to clone link/CTA). Uses the shared
      // connector token already resolved at the top of the handler. If Meta
      // rejects asset_feed_spec for this account/app, we fall back below to a
      // single-asset creative so the replace still succeeds.
      const adRes = await fetch(`${GRAPH}/${ad_id}?fields=id,name,status,creative{id}`, { headers });
      const adData: any = await adRes.json();
      if (adData.error) return Response.json({ error: adData.error.message }, { status: 502 });
      const wasActive = adData.status === 'ACTIVE';

      let baseSpec: any = {};
      let creativeLinkUrl: string | null = null;
      let creativeCta: any = null;
      if (adData.creative?.id) {
        const cr = await fetch(`${GRAPH}/${adData.creative.id}?fields=object_story_spec,link_url,call_to_action`, { headers });
        const cd: any = await cr.json();
        if (!cd.error) { baseSpec = cd.object_story_spec || {}; creativeLinkUrl = cd.link_url || null; creativeCta = cd.call_to_action || null; }
      }
      let page_id = baseSpec.page_id;
      if (!page_id) {
        const pr = await fetch(`${GRAPH}/me/accounts?fields=id&limit=1`, { headers });
        const pd: any = await pr.json();
        page_id = pd.data?.[0]?.id;
      }
      if (!page_id) return Response.json({ error: 'No Facebook Page connected to your account.' }, { status: 400 });

      const uploadImageBytes = async (bytes: Uint8Array, filename: string): Promise<string | null> => {
        const boundary = 'b44m' + Math.random().toString().slice(2);
        const head =
          `--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n${filename}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="${filename}"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
        const tail = `\r\n--${boundary}--\r\n`;
        const blob = new Blob([head, bytes, tail], { type: `multipart/form-data; boundary=${boundary}` });
        const r = await fetch(`${GRAPH}/${actId}/adimages`, { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: blob });
        const d: any = await r.json();
        return d?.images?.[filename]?.hash || null;
      };
      const uploadVideoBytes = async (bytes: Uint8Array, filename: string): Promise<string | null> => {
        const boundary = 'b44mv' + Math.random().toString().slice(2);
        const head = `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`;
        const tail = `\r\n--${boundary}--\r\n`;
        const blob = new Blob([head, bytes, tail], { type: `multipart/form-data; boundary=${boundary}` });
        const r = await fetch(`${GRAPH}/${actId}/advideos`, { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: blob });
        const d: any = await r.json();
        return d.id || null;
      };
      const decodeB64 = (dataUrl: string): Uint8Array => {
        const b64 = String(dataUrl).split(',').pop() || '';
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      };

      // Upload every asset; collect hashes / video ids. Assets may be provided
      // as hosted URLs (preferred — keeps the request payload small) or as
      // inline base64 (legacy). The function fetches any URL server-side and
      // forwards the bytes to Meta.
      const imageHashes: string[] = [];
      const videoIds: string[] = [];
      const uploadErrors: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        try {
          if (a.image_url || a.image_base64) {
            const bytes = a.image_url ? new Uint8Array(await (await fetch(a.image_url)).arrayBuffer()) : decodeB64(a.image_base64);
            const h = await uploadImageBytes(bytes, a.image_filename || `asset_${i + 1}.jpg`);
            if (h) imageHashes.push(h); else uploadErrors.push(`asset ${i + 1}: image upload failed`);
          } else if (a.video_url || a.video_base64) {
            const bytes = a.video_url ? new Uint8Array(await (await fetch(a.video_url)).arrayBuffer()) : decodeB64(a.video_base64);
            const v = await uploadVideoBytes(bytes, a.video_filename || `asset_${i + 1}.mp4`);
            if (v) videoIds.push(v); else uploadErrors.push(`asset ${i + 1}: video upload failed`);
          }
        } catch (e) { uploadErrors.push(`asset ${i + 1}: ${(e as Error).message}`); }
      }
      if (!imageHashes.length && !videoIds.length) return Response.json({ error: uploadErrors.join('; ') || 'all uploads failed' }, { status: 502 });

      const finalLink = link || creativeCta?.value?.link || baseSpec.link_data?.link || baseSpec.video_data?.link || creativeLinkUrl;
      if (!finalLink) return Response.json({ error: 'This ad has no destination link — enter a link for the replacement creative.' }, { status: 400 });
      const ctaType = creativeCta?.type || baseSpec.link_data?.call_to_action?.type || baseSpec.video_data?.call_to_action?.type || 'SHOP_NOW';

      // One placement-optimized creative: Meta auto-matches each asset to the
      // placement it fits (1:1→Feed, 4:5→Instagram Feed, 9:16→Stories/Reels).
      const af: any = { optimization_type: 'PLACEMENT', ad_formats: ['AUTOMATIC_FORMAT'] };
      if (imageHashes.length) af.images = imageHashes.map((h) => ({ hash: h }));
      if (videoIds.length) af.videos = videoIds.map((v) => ({ video_id: v }));
      af.bodies = [{ text: message || baseSpec.link_data?.message || baseSpec.video_data?.message || '' }];
      af.titles = [{ text: headline || baseSpec.link_data?.name || baseSpec.video_data?.title || adData.name || '' }];
      af.link_urls = [{ website_url: finalLink }];
      af.call_to_action_types = [ctaType];

      let crRes = await fetch(`${GRAPH}/${actId}/adcreatives`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: (adData.name || 'Ad') + ' (placement optimized)', page_id, asset_feed_spec: af }),
      });
      let crData: any = await crRes.json();
      let usedFallback = false;
      let fallbackNote: string | null = null;
      let fallbackErr: string | null = null;

      if (crData.error) {
        // Some Meta apps/accounts lack the asset_feed capability (error #3). Fall
        // back to a single-asset creative (first image or first video) so the
        // replace still succeeds, and flag that multi-ratio placement
        // optimization isn't available for this account.
        const afErrDetail = [crData.error.message, crData.error.error_subcode ? `subcode ${crData.error.error_subcode}` : '', crData.error.error_user_msg, crData.error.error_user_title].filter(Boolean).join(' · ');
        fallbackErr = afErrDetail;
        const singleHash = imageHashes[0] || null;
        const singleVideo = videoIds[0] || null;
        if (!singleHash && !singleVideo) {
          return Response.json({ error: 'creative: ' + afErrDetail }, { status: 502 });
        }
        let fbSpec: any;
        if (singleHash) {
          const linkData = baseSpec.link_data ? JSON.parse(JSON.stringify(baseSpec.link_data)) : {};
          delete linkData.image_url; delete linkData.image_crops; delete linkData.url_tags;
          linkData.image_hash = singleHash;
          if (message) linkData.message = message;
          if (headline) linkData.name = headline;
          linkData.link = finalLink;
          if (!linkData.call_to_action) linkData.call_to_action = creativeCta || { type: ctaType, value: { link: finalLink } };
          fbSpec = { page_id, link_data: linkData };
        } else {
          const videoData: any = { video_id: singleVideo };
          if (message) videoData.message = message;
          if (headline) videoData.title = headline;
          fbSpec = { page_id, video_data: videoData };
        }
        crRes = await fetch(`${GRAPH}/${actId}/adcreatives`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: (adData.name || 'Ad') + ' (replaced)', object_story_spec: fbSpec }),
        });
        crData = await crRes.json();
        if (crData.error) {
          const e = crData.error;
          const detail = [e.message, e.error_subcode ? `subcode ${e.error_subcode}` : '', e.error_user_msg, e.error_user_title].filter(Boolean).join(' · ');
          return Response.json({ error: 'creative: ' + detail }, { status: 502 });
        }
        usedFallback = true;
        fallbackNote = `Placement-optimized asset feed isn't available for this Meta app (${afErrDetail}) — used your first uploaded image/video as a single creative instead.`;
      }

      // Replace the existing ad's creative (pause/resume if it was active).
      if (wasActive) {
        await fetch(`${GRAPH}/${ad_id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'PAUSED' }) });
      }
      const upRes = await fetch(`${GRAPH}/${ad_id}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ creative: { creative_id: crData.id } }),
      });
      const upData: any = await upRes.json();
      if (upData.error) {
        if (wasActive) await fetch(`${GRAPH}/${ad_id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }) });
        return Response.json({ error: 'ad update: ' + upData.error.message, new_creative_id: crData.id }, { status: 502 });
      }
      if (wasActive) {
        await fetch(`${GRAPH}/${ad_id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }) });
      }

      return Response.json({ success: true, ad_id, new_creative_id: crData.id, was_active: wasActive, image_count: imageHashes.length, video_count: videoIds.length, upload_errors: uploadErrors, fallback: usedFallback, note: fallbackNote, asset_feed_error: fallbackErr });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});