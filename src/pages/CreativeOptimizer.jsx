import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Loader2, Sparkles, AlertCircle, Wand2, CheckCircle2, ImagePlus, X, Video, Trash2 } from 'lucide-react';
import ReplaceCreative from '@/components/ReplaceCreative';

const RATIOS = [
  { value: '1:1', label: '1:1 · Feed', w: 1, h: 1 },
  { value: '4:5', label: '4:5 · Instagram Feed', w: 4, h: 5 },
  { value: '9:16', label: '9:16 · Stories / Reels', w: 9, h: 16 },
  { value: '1.91:1', label: '1.91:1 · Link ads', w: 1.91, h: 1 },
];

export default function CreativeOptimizer() {
  const [accLoading, setAccLoading] = useState(true);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState([]); // [{ name, url }] data URLs
  const [videos, setVideos] = useState([]); // [{ name, url }] data URLs
  const [ratio, setRatio] = useState('1:1');
  // Track live state of created variants: { ad_id: { status, busy, error } }
  const [variantStates, setVariantStates] = useState({});

  const setVState = (adId, patch) =>
    setVariantStates((prev) => ({ ...prev, [adId]: { ...(prev[adId] || {}), ...patch } }));

  const toggleVariant = async (adId, target) => {
    setVState(adId, { busy: true, error: null });
    try {
      await base44.functions.invoke('metaAds', {
        action: 'update_ad_status',
        ad_id: adId,
        status: target,
      });
      setVState(adId, { status: target, busy: false });
    } catch (e) {
      setVState(adId, { busy: false, error: e?.message || 'Failed' });
    }
  };

  const deleteVariant = async (adId) => {
    setVState(adId, { busy: true, error: null });
    try {
      await base44.functions.invoke('metaAds', { action: 'delete_ad', ad_id: adId });
      setVState(adId, { status: 'DELETED', busy: false, removed: true });
    } catch (e) {
      setVState(adId, { busy: false, error: e?.message || 'Delete failed' });
    }
  };

  // Seed each created variant as PAUSED when a new result arrives.
  useEffect(() => {
    if (!result?.generated?.variants) return;
    const next = {};
    for (const v of result.generated.variants) {
      if (v.new_ad_id) next[v.new_ad_id] = { status: 'PAUSED', busy: false, error: null };
    }
    setVariantStates(next);
  }, [result]);

  const cropToRatio = (dataUrl, rw, rh) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const targetW = 1080;
        const targetH = Math.round((1080 * rh) / rw);
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        const srcRatio = img.width / img.height;
        const dstRatio = targetW / targetH;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (srcRatio > dstRatio) {
          sw = img.height * dstRatio;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / dstRatio;
          sy = (img.height - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke('metaAds', {
          action: 'list_accounts',
        });
        const accs = res.data.accounts || [];
        const cfgs = await base44.entities.AppConfig.list();
        const saved = cfgs[0]?.selected_ad_account_id;
        setAccount(
          accs.find((a) => String(a.account_id) === String(saved)) ||
            accs[0] ||
            null
        );
      } catch (e) {
        setError(e.message);
      } finally {
        setAccLoading(false);
      }
    })();
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke('optimizeCreatives', {
        auto_tune: true,
        generate: true,
        variant_images: picked.map((p) => p.url),
        variant_videos: videos.map((v) => v.url),
      });
      setResult(res.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const r = RATIOS.find((x) => x.value === ratio) || RATIOS[0];
    const items = await Promise.all(
      files.map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async () => {
              const cropped = await cropToRatio(reader.result, r.w, r.h);
              resolve({ name: file.name, url: cropped });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );
    setPicked((prev) => [...prev, ...items]);
  };

  const clearAll = () => { setPicked([]); setVideos([]); };

  const handlePickVideo = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    Promise.all(
      files.map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, url: reader.result });
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    ).then((items) => setVideos((prev) => [...prev, ...items]));
  };

  const removeVideo = (i) => setVideos((prev) => prev.filter((_, idx) => idx !== i));

  const removePicked = (i) => setPicked((prev) => prev.filter((_, idx) => idx !== i));

  const thumbMap = {};
  (result?.ads || []).forEach((a) => {
    thumbMap[a.ad_id] = a.thumbnail;
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wand2 className="h-6 w-6" /> Creative Optimizer
          </h1>
          <p className="text-muted-foreground text-sm">
            AI scores your ad creatives, pauses losers, boosts winners, and
            drafts a new image variant.
          </p>
        </div>
        <Button onClick={run} disabled={loading || !account}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Optimizing…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Optimize now
            </>
          )}
        </Button>
      </div>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ImagePlus className="h-4 w-4" /> Your images (optional)
          </div>
          <p className="text-xs text-muted-foreground">
            Upload your own images and the optimizer will build new paused variants from
            the best-performing ad — applying AI-suggested headline/message improvements.
            Leave empty to let the AI generate a variant instead.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Aspect ratio:</span>
            <Select value={ratio} onValueChange={setRatio}>
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATIOS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {picked.length > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAll}>
                Clear all
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {picked.map((p, i) => {
              const r = RATIOS.find((x) => x.value === ratio) || RATIOS[0];
              const isPortrait = r.h > r.w;
              const box = isPortrait ? 'w-14 h-20' : r.value === '1.91:1' ? 'w-24 h-14' : 'w-20 h-20';
              return (
                <div key={i} className={`relative ${box} rounded-md overflow-hidden border bg-muted`}>
                  <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePicked(i)}
                    className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-input text-muted-foreground hover:bg-accent">
              <ImagePlus className="h-5 w-5" />
              <input type="file" accept="image/*" multiple className="hidden" onChange={handlePick} />
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Video className="h-4 w-4" /> Your videos (optional)
          </div>
          <p className="text-xs text-muted-foreground">
            Upload MP4 clips and the optimizer will build paused video ad variants from
            the best-performing ad, using the same AI-suggested headline/message copy.
            Keep clips short (under ~30s) for fastest upload.
          </p>
          <div className="flex flex-wrap gap-3">
            {videos.map((v, i) => (
              <div key={i} className="relative w-24 h-20 rounded-md overflow-hidden border bg-muted">
                <video src={v.url} className="w-full h-full object-cover" muted />
                <button
                  type="button"
                  onClick={() => removeVideo(i)}
                  className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <label className="flex h-20 w-24 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-input text-muted-foreground hover:bg-accent">
              <Video className="h-5 w-5" />
              <input type="file" accept="video/mp4,video/*" multiple className="hidden" onChange={handlePickVideo} />
            </label>
          </div>
        </CardContent>
      </Card>

      <ReplaceCreative account={account} />

      {accLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {result.summary && (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm whitespace-pre-wrap">{result.summary}</p>
              </CardContent>
            </Card>
          )}

          {result.generated && (
            <Card>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-start gap-2 text-sm">
                  {result.generated.ok ? (
                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                  )}
                  <div>
                    {result.generated.ok
                      ? `${result.generated.count || 1} new paused variant(s) created.`
                      : `Variant generation failed: ${result.generated.error}`}
                  </div>
                </div>
                {result.generated.image_plan && result.generated.image_plan.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">AI image matching:</p>
                    {result.generated.image_plan.map((p, i) => (
                      <div key={i} className="flex gap-2 text-xs border rounded-md p-2 bg-muted/40">
                        <Badge variant="outline" className="shrink-0">img {i + 1}</Badge>
                        <div className="space-y-0.5">
                          <div className="font-medium">→ {thumbMap[p.ad_id] ? 'ad' : 'ad'} {p.ad_id}</div>
                          {p.headline && <div className="text-muted-foreground">Headline: “{p.headline}”</div>}
                          {p.message && <div className="text-muted-foreground">Message: “{p.message}”</div>}
                          {p.reason && <div className="text-muted-foreground italic">{p.reason}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {result.generated.variants && result.generated.variants.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Created variants ({result.generated.variants.length}) — check state & activate:
                    </p>
                    {result.generated.variants.map((v, i) => {
                      const id = v.new_ad_id;
                      const st = variantStates[id] || { status: 'PAUSED' };
                      const isActive = st.status === 'ACTIVE';
                      return (
                        <div key={i} className="flex items-center gap-3 text-xs border rounded-md p-2 bg-muted/40">
                          <Badge variant="outline" className="shrink-0">var {i + 1}</Badge>
                          <div className="flex-1 space-y-0.5">
                            <div className="font-medium">{v.new_ad_id ? `ad ${v.new_ad_id}` : 'creation failed'}</div>
                            {v.cloned_from && <div className="text-muted-foreground">cloned from ad {v.cloned_from}</div>}
                            {v.headline && <div className="text-muted-foreground">“{v.headline}”</div>}
                            {v.error && <div className="text-destructive">error: {v.error}</div>}
                            {st.error && <div className="text-destructive">{st.error}</div>}
                          </div>
                          {id && (
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant={isActive ? 'default' : 'secondary'}>{st.status || 'PAUSED'}</Badge>
                              {v.ok && (
                                <Button
                                  size="sm"
                                  variant={isActive ? 'outline' : 'default'}
                                  className="h-7 text-xs"
                                  disabled={st.busy}
                                  onClick={() => toggleVariant(id, isActive ? 'PAUSED' : 'ACTIVE')}
                                >
                                  {st.busy ? (
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  ) : isActive ? (
                                    'Pause'
                                  ) : (
                                    'Activate'
                                  )}
                                </Button>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                disabled={st.busy}
                                title="Delete variant"
                                onClick={() => deleteVariant(id)}
                              >
                                {st.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {result.generated.variants.some((v) => v.ok && v.new_ad_id) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs"
                        disabled={Object.values(variantStates).some((s) => s.busy)}
                        onClick={() =>
                          Promise.all(
                            Object.keys(variantStates)
                              .filter((id) => variantStates[id].status !== 'ACTIVE')
                              .map((id) => toggleVariant(id, 'ACTIVE'))
                          )
                        }
                      >
                        Activate all
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3">
            {(result.analyses || []).map((a) => (
              <Card key={a.ad_id}>
                <CardContent className="py-4 flex gap-4">
                  {thumbMap[a.ad_id] && (
                    <img
                      src={thumbMap[a.ad_id]}
                      alt=""
                      className="w-24 h-24 object-contain rounded-md border bg-muted shrink-0"
                    />
                  )}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={
                          a.action === 'pause'
                            ? 'destructive'
                            : a.action === 'boost'
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {a.action}
                      </Badge>
                      <span className="text-sm font-medium">Score: {a.score}</span>
                      {a.generate_variant && (
                        <Badge variant="outline">new variant</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{a.reason}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {result.actions && result.actions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actions taken</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {result.actions.map((x, i) => (
                  <div key={i}>
                    {x.action === 'paused'
                      ? `Paused ad ${x.ad_id}`
                      : `Boosted adset budget to $${(x.new_budget_cents / 100).toFixed(2)} for ad ${x.ad_id}`}
                    {x.error ? ` — error: ${x.error}` : ''}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}