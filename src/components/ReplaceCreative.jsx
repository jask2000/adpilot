import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Loader2,
  RefreshCw,
  ImagePlus,
  Video,
  X,
  Replace,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

const RATIOS = [
  { value: '1:1', label: '1:1 · Feed', w: 1, h: 1 },
  { value: '4:5', label: '4:5 · Instagram Feed', w: 4, h: 5 },
  { value: '9:16', label: '9:16 · Stories / Reels', w: 9, h: 16 },
  { value: '1.91:1', label: '1.91:1 · Link ads', w: 1.91, h: 1 },
];

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

export default function ReplaceCreative({ account }) {
  const [ads, setAds] = useState(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adId, setAdId] = useState(null);
  const [images, setImages] = useState([]); // { ratio, name, url }
  const [videos, setVideos] = useState([]); // { name, url }
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const fetchAds = async () => {
    if (!account) return;
    setAdsLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('metaAds', {
        action: 'list_ads',
        account_id: account.account_id,
      });
      setAds(res.data.ads || []);
    } catch (e) {
      setError(e.message);
      setAds([]);
    } finally {
      setAdsLoading(false);
    }
  };

  useEffect(() => {
    fetchAds();
  }, [account?.account_id]);

  const addImages = async (files, ratioValue) => {
    const r = RATIOS.find((x) => x.value === ratioValue) || RATIOS[0];
    const made = await Promise.all(
      files.map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async () => {
              const cropped = await cropToRatio(reader.result, r.w, r.h);
              resolve({ ratio: ratioValue, name: file.name, url: cropped });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );
    setImages((prev) => [...prev, ...made]);
  };

  const setRatioFor = (i, ratioValue) =>
    setImages((prev) => prev.map((it, idx) => (idx === i ? { ...it, ratio: ratioValue } : it)));

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const addVideos = (files) => {
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

  const selectedAd = (ads || []).find((a) => a.id === adId);

  const replace = async () => {
    if (!adId) { setError('Select an ad first.'); return; }
    if (!images.length && !videos.length) {
      setError('Upload at least one image or video.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const assets = [
        ...images.map((img, i) => ({
          image_base64: img.url,
          image_filename: `img_${i + 1}.jpg`,
        })),
        ...videos.map((v, i) => ({
          video_base64: v.url,
          video_filename: `vid_${i + 1}.mp4`,
        })),
      ];
      const res = await base44.functions.invoke('metaAds', {
        action: 'replace_creative_multi',
        account_id: account.account_id,
        ad_id: adId,
        assets,
        headline: headline || undefined,
        message: message || undefined,
        link: link || undefined,
      });
      setResult(res.data);
      setImages([]);
      setVideos([]);
      setHeadline('');
      setMessage('');
      setLink('');
      fetchAds();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  if (!account) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Replace className="h-4 w-4" /> Replace creative — all ratios + video
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          The first asset replaces the selected ad's creative (active ads are
          briefly paused and resumed). Each additional image or video becomes a
          new variant ad under the same ad set — so every placement gets a
          properly framed creative instead of auto-cropping one image.
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Ad</Label>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={fetchAds} disabled={adsLoading}>
              <RefreshCw className={`h-3 w-3 mr-1 ${adsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <Select value={adId || ''} onValueChange={setAdId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={adsLoading ? 'Loading ads…' : 'Select an ad'} />
            </SelectTrigger>
            <SelectContent>
              {(ads || []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedAd?.thumbnail && (
          <div className="flex items-center gap-3 rounded-md border p-2 bg-muted/40">
            <img
              src={selectedAd.thumbnail}
              alt=""
              className="w-16 h-16 object-contain rounded border bg-background shrink-0"
            />
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>Current creative of selected ad.</div>
              {selectedAd.insights && (
                <div>
                  Spend ${selectedAd.insights.spend ? parseFloat(selectedAd.insights.spend).toFixed(2) : '0.00'}
                  {' · '}CTR {selectedAd.insights.ctr ? parseFloat(selectedAd.insights.ctr).toFixed(2) : '0'}%
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs">Images (one per ratio)</Label>
          {images.map((p, i) => {
            const r = RATIOS.find((x) => x.value === p.ratio) || RATIOS[0];
            const isPortrait = r.h > r.w;
            const box = isPortrait ? 'w-14 h-20' : r.value === '1.91:1' ? 'w-24 h-14' : 'w-16 h-16';
            return (
              <div key={i} className="flex items-center gap-3 rounded-md border p-2 bg-muted/30">
                <div className={`relative ${box} rounded-md overflow-hidden border bg-muted shrink-0`}>
                  <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 space-y-1.5">
                  <div className="text-xs text-muted-foreground truncate">{p.name}</div>
                  <Select value={p.ratio} onValueChange={(v) => setRatioFor(i, v)}>
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RATIOS.map((rr) => (
                        <SelectItem key={rr.value} value={rr.value}>{rr.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-foreground hover:bg-destructive hover:text-destructive-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-2">
            {RATIOS.filter((r) => r.value !== '1:1').map((r) => (
              <label
                key={r.value}
                className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-input text-muted-foreground hover:bg-accent text-xs"
              >
                <ImagePlus className="h-4 w-4" />
                {r.label}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = '';
                    if (files.length) addImages(files, r.value);
                  }}
                />
              </label>
            ))}
          </div>
          <label className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-input text-muted-foreground hover:bg-accent text-xs">
            <ImagePlus className="h-4 w-4" />
            Add 1:1 · Feed image
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                if (files.length) addImages(files, '1:1');
              }}
            />
          </label>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Videos</Label>
          <div className="flex flex-wrap gap-2">
            {videos.map((v, i) => (
              <div key={i} className="relative w-24 h-16 rounded-md overflow-hidden border bg-muted">
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
            <label className="flex h-16 w-24 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-input text-muted-foreground hover:bg-accent">
              <Video className="h-4 w-4" />
              <input type="file" accept="video/mp4,video/*" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) addVideos(f); }} />
            </label>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Leave headline/message blank to keep the ad's existing copy, or set new
          text to apply across all creatives.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">New headline (optional)</Label>
            <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Keep existing" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">New message (optional)</Label>
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Keep existing" className="h-8 text-sm" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Destination link (required if the ad has no link)</Label>
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="h-8 text-sm" />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
        {result && result.success && (
          <div className="flex items-start gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Replaced the ad's creative{result.was_active ? ' (resumed)' : ''}{result.created ? `, and created ${result.created} variant ad(s)` : ''}.
            </span>
          </div>
        )}
        {result && !result.success && result.results && (
          <div className="text-xs text-destructive space-y-1">
            {result.results.filter((r) => !r.ok).map((r, i) => (
              <div key={i}>Asset {r.index + 1}: {r.error}</div>
            ))}
          </div>
        )}

        <Button onClick={replace} disabled={busy || !adId || (!images.length && !videos.length)}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Replacing…
            </>
          ) : (
            <>
              <Replace className="h-4 w-4 mr-2" />
              Replace creative
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}