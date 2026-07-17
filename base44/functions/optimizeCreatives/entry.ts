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
      'CRITICAL for new_image_prompt: keep the HELLCRUST PIZZA branding fully intact (logo, brand colors, fonts, style). ' +
      'Do NOT add any people, faces, models, avatars, or human figures — keep it simple: pizza, food, ingredients, text overlays, ' +
      'and brand graphics only. Keep the same product-forward layout. ' +
      'When the user will supply their own images, also suggest improved ad copy: new_headline (short, punchy) and new_message (1-2 line body text) ' +
      'that would outperform the original, preserving Hellcrust tone of voice. Return analyses for every ad_id provided.\n\nAds:\n' +
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
              new_headline: { type: 'string' },
              new_message: { type: 'string' },
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

    // 3. Generate new paused variant(s) from the best performer.
    //    If the user supplied images (variant_images, base64 data URLs), use those;
    //    otherwise fall back to AI-generated image. Apply AI-suggested text improvements
    //    (new_headline / new_message) to the new creative's link_data.
    let generated: any = null;
    if (generate) {
      const userImages: string[] = Array.isArray(body.variant_images) ? body.variant_images.filter(Boolean) : [];
      const userVideos: string[] = Array.isArray(body.variant_videos) ? body.variant_videos.filter(Boolean) : [];

      // Pick the best ad to clone a variant from. Prefer ads the AI flagged for
      // a variant; if none were flagged BUT the user supplied their own media,
      // fall back to the top-scoring ad that has a creative so their uploads
      // are always used.
      let best = analyses
        .filter((a: any) => a.generate_variant && itemMap[a.ad_id]?.creative_id)
        .sort((x: any, y: any) => (y.score || 0) - (x.score || 0))[0];
      if (!best && (userImages.length || userVideos.length)) {
        best = analyses
          .filter((a: any) => itemMap[a.ad_id]?.creative_id)
          .sort((x: any, y: any) => (y.score || 0) - (x.score || 0))[0];
      }

      if (best) {
        const it = itemMap[best.ad_id];
        try {
          const uploadB64 = async (dataUrl: string, filename: string): Promise<string | null> => {
            const b64 = String(dataUrl).split(',').pop() || '';
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const boundary = 'b44opt' + Math.random().toString().slice(2);
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

          // Collect image hashes for the new variant(s).
          const hashes: string[] = [];
          if (userImages.length) {
            for (let i = 0; i < userImages.length; i++) {
              const h = await uploadB64(userImages[i], `variant_${i + 1}.jpg`);
              if (h) hashes.push(h);
            }
          } else if (best.new_image_prompt) {
            const imgRes: any = await base44.asServiceRole.integrations.Core.GenerateImage({
              prompt: (best.new_image_prompt || '') +
                '. Keep the HELLCRUST PIZZA branding intact (logo, brand colors, fonts). ' +
                'No people, faces, models, avatars, or human figures. Simple product/food-forward design.',
              existing_image_urls: it.thumbnail ? [it.thumbnail] : undefined,
            });
            const imgUrl = imgRes?.url;
            if (imgUrl) {
              const imgResp = await fetch(imgUrl);
              const ab = await imgResp.arrayBuffer();
              const bytes = new Uint8Array(ab);
              const b64 = btoa(String.fromCharCode(...Array.from(bytes)));
              const h = await uploadB64(`data:image/jpeg;base64,${b64}`, 'aivariant.jpg');
              if (h) hashes.push(h);
            }
          }

          if (hashes.length && it.creative_id) {
            const cr3 = await fetch(`${GRAPH}/${it.creative_id}?fields=object_story_spec,name`, { headers });
            const cd3: any = await cr3.json();
            const baseSpec: any = cd3.object_story_spec;
            if (baseSpec) {
              const variants: any[] = [];
              for (let i = 0; i < hashes.length; i++) {
                const spec = JSON.parse(JSON.stringify(baseSpec));
                if (spec.link_data) {
                  spec.link_data.image_hash = hashes[i];
                  if (best.new_message) spec.link_data.message = best.new_message;
                  if (best.new_headline) spec.link_data.name = best.new_headline;
                }
                const label = (it.name || 'Ad') + (hashes.length > 1 ? ` (variant ${i + 1})` : ' (variant)');
                const cr4 = await fetch(`${GRAPH}/${actId}/adcreatives`, {
                  method: 'POST',
                  headers: { ...headers, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: label, object_story_spec: spec }),
                });
                const cd4: any = await cr4.json();
                if (cd4.id) {
                  const ar3 = await fetch(`${GRAPH}/${actId}/ads`, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: label, adset_id: it.adset_id, creative: { creative_id: cd4.id }, status: 'PAUSED' }),
                  });
                  const adData: any = await ar3.json();
                  variants.push({ new_ad_id: adData.id, ok: !adData.error, error: adData.error?.message });
                } else {
                  variants.push({ ok: false, error: cd4.error?.message || 'creative create failed' });
                }
              }
              generated = { from: it.ad_id, ok: variants.some((v) => v.ok), count: variants.length, variants };
            }
          }

          // 3b. Video variants — upload user videos and build video creatives.
          if (userVideos.length && it.creative_id) {
            const cr3 = await fetch(`${GRAPH}/${it.creative_id}?fields=object_story_spec,name`, { headers });
            const cd3: any = await cr3.json();
            const baseSpec: any = cd3.object_story_spec || {};
            const page_id = baseSpec.page_id;
            let resolvedPageId = page_id;
            if (!resolvedPageId) {
              const pr = await fetch(`${GRAPH}/me/accounts?fields=id&limit=1`, { headers });
              const pd: any = await pr.json();
              resolvedPageId = pd.data?.[0]?.id;
            }
            if (resolvedPageId) {
              const uploadVid = async (dataUrl: string, filename: string): Promise<string | null> => {
                const b64 = String(dataUrl).split(',').pop() || '';
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const boundary = 'b44vid' + Math.random().toString().slice(2);
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
                const d: any = await vr.json();
                return d?.id || null;
              };
              const vidVariants: any[] = [];
              for (let i = 0; i < userVideos.length; i++) {
                const vidId = await uploadVid(userVideos[i], `variant_${i + 1}.mp4`);
                if (!vidId) { vidVariants.push({ ok: false, error: 'video upload failed' }); continue; }
                const videoData: any = { video_id: vidId };
                if (best.new_message) videoData.message = best.new_message;
                if (best.new_headline) videoData.title = best.new_headline;
                const label = (it.name || 'Ad') + (userVideos.length > 1 ? ` (video ${i + 1})` : ' (video)');
                const spec = { page_id: resolvedPageId, video_data: videoData };
                const cr4 = await fetch(`${GRAPH}/${actId}/adcreatives`, {
                  method: 'POST',
                  headers: { ...headers, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: label, object_story_spec: spec }),
                });
                const cd4: any = await cr4.json();
                if (cd4.id) {
                  const ar3 = await fetch(`${GRAPH}/${actId}/ads`, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: label, adset_id: it.adset_id, creative: { creative_id: cd4.id }, status: 'PAUSED' }),
                  });
                  const adData: any = await ar3.json();
                  vidVariants.push({ new_ad_id: adData.id, ok: !adData.error, error: adData.error?.message, video_id: vidId });
                } else {
                  vidVariants.push({ ok: false, error: cd4.error?.message || 'video creative failed', video_id: vidId });
                }
              }
              const imgOk = generated?.ok;
              const imgCount = generated?.count || 0;
              generated = {
                from: it.ad_id,
                ok: (imgOk || false) || vidVariants.some((v) => v.ok),
                count: imgCount + vidVariants.length,
                variants: [...(generated?.variants || []), ...vidVariants],
                videos: vidVariants,
              };
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