import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const GRAPH = 'https://graph.facebook.com/v25.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const accessToken = Deno.env.get('META_ACCESS_TOKEN');
    if (!accessToken) return Response.json({ error: 'META_ACCESS_TOKEN secret not set' }, { status: 500 });
    const headers = { 'Authorization': `Bearer ${accessToken}` };

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === 'status') {
      const r = await fetch(`${GRAPH}/me?fields=id,name`, { headers });
      const data = await r.json();
      if (data.error) return Response.json({ connected: false, error: data.error.message }, { status: 200 });
      return Response.json({ connected: true, account: data });
    }

    if (action === 'list_accounts') {
      const r = await fetch(`${GRAPH}/me/adaccounts?fields=account_id,name,currency,amount_spent&limit=100`, { headers });
      const data = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ accounts: data.data || [] });
    }

    if (action === 'list_ads') {
      const { account_id } = body;
      if (!account_id) return Response.json({ error: 'account_id required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      const ar = await fetch(`${GRAPH}/${actId}/ads?fields=id,name,status,adset_id,creative{id,thumbnail_url,name}&limit=200`, { headers });
      const adata: any = await ar.json();
      if (adata.error) return Response.json({ error: adata.error.message }, { status: 502 });
      return Response.json({ ads: adata.data || [] });
    }

    if (action === 'replace_creative_multi') {
      const { account_id, ad_id, assets, headline, message, link } = body;
      if (!account_id || !ad_id) return Response.json({ error: 'account_id and ad_id required' }, { status: 400 });
      const list: any[] = Array.isArray(assets) ? assets.filter((a) => a && (a.image_url || a.video_url || a.image_base64 || a.video_base64)) : [];
      if (!list.length) return Response.json({ error: 'assets required' }, { status: 400 });
      const actId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;

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

      if (crData.error) {
        // Fallback: single-asset creative if asset_feed_spec unsupported for this app/account.
        const afErrDetail = [crData.error.message, crData.error.error_subcode ? `subcode ${crData.error.error_subcode}` : '', crData.error.error_user_msg, crData.error.error_user_title].filter(Boolean).join(' · ');
        const singleHash = imageHashes[0] || null;
        const singleVideo = videoIds[0] || null;
        if (!singleHash && !singleVideo) return Response.json({ error: 'creative: ' + afErrDetail }, { status: 502 });
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
      }

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

      return Response.json({ success: true, ad_id, new_creative_id: crData.id, was_active: wasActive, image_count: imageHashes.length, video_count: videoIds.length, upload_errors: uploadErrors });
    }

    if (action === 'update_ad_status') {
      const { ad_id, status } = body;
      if (!ad_id || !status) return Response.json({ error: 'ad_id and status required' }, { status: 400 });
      const r = await fetch(`${GRAPH}/${ad_id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const data = await r.json();
      if (data.error) return Response.json({ error: data.error.message }, { status: 502 });
      return Response.json({ success: true });
    }

    if (action === 'delete_ad') {
      const { ad_id } = body;
      if (!ad_id) return Response.json({ error: 'ad_id required' }, { status: 400 });
      let archived = false;
      try {
        const ar = await fetch(`${GRAPH}/${ad_id}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ARCHIVED' }) });
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

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});