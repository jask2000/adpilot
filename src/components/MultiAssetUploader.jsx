import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload, Video, X, Sparkles, Loader2, Film, ImagePlus } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { base44 } from '@/api/base44Client';
import { getImageDimensions, closestRatio, ASSET_RATIOS } from '@/lib/mediaCrop';
import { appendLogoOutro } from '@/lib/videoOutro';

const LOGO_STORAGE_KEY = 'hellcrust_logo_url';

const VIDEO_RATIOS = [
  { value: '1:1', ar: '1:1', label: '1:1 (Feed / Square)', note: 'Feed · ≤15s' },
  { value: '4:5', ar: '4:5', label: '4:5 (Feed Portrait)', note: 'IG Feed · ≤15s' },
  { value: '9:16', ar: '9:16', label: '9:16 (Stories / Reels)', note: 'Stories ≤15s · Reels ≤90s' },
  { value: '16:9', ar: '16:9', label: '16:9 (Landscape)', note: 'In-stream ≤15s · Right col ≤15s' },
];

// Veo only supports 16:9 and 9:16 for AI generation
const VEO_RATIOS = VIDEO_RATIOS.filter((r) => r.value === '9:16' || r.value === '16:9');

// Collects multiple images and videos across all common ad ratios.
// Calls onAssets([{ ratio, kind: 'image'|'video', base64?, url?, name }]).
export default function MultiAssetUploader({ assets, onAssets }) {
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoRatio, setVideoRatio] = useState('9:16');
  const [showVideoGen, setShowVideoGen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [tab, setTab] = useState('img-1:1');
  const [useStartImage, setUseStartImage] = useState(false);
  const [startImageIdx, setStartImageIdx] = useState('');
  const [chatTargetIdx, setChatTargetIdx] = useState(null);
  const [chatPrompt, setChatPrompt] = useState('');
  const [logoUrl, setLogoUrl] = useState(() => {
    try { return localStorage.getItem(LOGO_STORAGE_KEY) || ''; } catch (_) { return ''; }
  });
  const [logoUploading, setLogoUploading] = useState(false);

  const uploadLogo = async (file) => {
    if (!file) return;
    setLogoUploading(true);
    try {
      const up = await base44.integrations.Core.UploadFile({ file });
      const url = up.file_url;
      setLogoUrl(url);
      try { localStorage.setItem(LOGO_STORAGE_KEY, url); } catch (_) {}
    } catch (e) {
      setGenError('Logo upload failed: ' + ((e && e.message) || 'unknown'));
    } finally {
      setLogoUploading(false);
    }
  };

  const removeLogo = () => {
    setLogoUrl('');
    try { localStorage.removeItem(LOGO_STORAGE_KEY); } catch (_) {}
  };

  // Composite the brand logo outro onto a freshly generated video.
  const addVideoAsset = async (src, isBase64, baseName) => {
    if (logoUrl) {
      setGenError(null);
      try {
        const composited = await appendLogoOutro(src, logoUrl, videoRatio);
        onAssets([
          ...assets,
          { ratio: videoRatio, kind: 'video', base64: composited, name: baseName + '_logo.webm' },
        ]);
      } catch (e) {
        // If compositing fails, fall back to the raw generated video.
        setGenError('Logo outro failed — saved raw video: ' + ((e && e.message) || 'unknown'));
        onAssets([
          ...assets,
          { ratio: videoRatio, kind: 'video', [isBase64 ? 'base64' : 'url']: src, name: baseName + '.mp4' },
        ]);
      }
    } else {
      onAssets([
        ...assets,
        { ratio: videoRatio, kind: 'video', [isBase64 ? 'base64' : 'url']: src, name: baseName + '.mp4' },
      ]);
    }
  };

  // One tab per image ratio + one per video ratio.
  const TABS = [
    ...ASSET_RATIOS.map((r) => ({ key: 'img-' + r.value, ratio: r.value, kind: 'image', label: r.value + ' image' })),
    ...VIDEO_RATIOS.map((r) => ({ key: 'vid-' + r.value, ratio: r.value, kind: 'video', label: r.value + ' video · ' + r.note })),
  ];

  const firstImage = assets.find((a) => a.kind === 'image');
  const imageAssets = assets.map((a, i) => ({ a, i })).filter(({ a }) => a.kind === 'image');

  const addFiles = async (kind, files) => {
    setBusy(true);
    try {
      const next = [...assets];
      for (const file of files) {
        if (kind === 'image') {
          const dataUrl = await readAsDataUrl(file);
          const dims = await getImageDimensions(dataUrl);
          const ratioVal = closestRatio(dims.w, dims.h);
          // Keep the full original image untouched (no crop) so all content
          // is preserved — the ratio label reflects its true aspect ratio.
          next.push({ ratio: ratioVal, kind: 'image', base64: dataUrl, name: file.name });
        } else {
          const dataUrl = await readAsDataUrl(file);
          const ratioVal = await getVideoRatio(dataUrl);
          next.push({ ratio: ratioVal, kind: 'video', base64: dataUrl, name: file.name });
        }
      }
      onAssets(next);
    } finally {
      setBusy(false);
    }
  };

  const remove = (i) => onAssets(assets.filter((_, idx) => idx !== i));

  // AI-generate a video from a text prompt (Veo), optionally seeded by an
  // existing image. When a start image is selected, the actual image is
  // uploaded and passed to Veo 3.1's image-to-video endpoint.
  const generateVideo = async () => {
    if (!videoPrompt.trim()) return;
    setBusy(true);
    setGenError(null);
    try {
      let prompt = videoPrompt.trim();
      if (useStartImage) {
        // startImageIdx is the index in the original assets array (from the
        // dropdown values), so look up from assets directly — not imageAssets.
        const imgAsset = assets[parseInt(startImageIdx, 10)];
        if (imgAsset && imgAsset.kind === 'image') {
          let srcUrl = imgAsset.url;
          if (!srcUrl && imgAsset.base64) {
            const blob = await (await fetch(imgAsset.base64)).blob();
            const fileObj = new File([blob], imgAsset.name || 'start.jpg', { type: 'image/jpeg' });
            const up = await base44.integrations.Core.UploadFile({ file: fileObj });
            srcUrl = up.file_url;
          }
          if (srcUrl) {
            // Use Google Veo image-to-video: the actual start image is passed to the model.
            const res = await base44.functions.invoke('veoImageVideo', {
              sourceUrl: srcUrl,
              prompt: prompt + '. Professional food advertising style, appetizing, studio lighting, no people, no text overlay.',
              ratio: videoRatio,
              duration: 6,
            });
            const data = res?.data;
            if (!data?.base64) throw new Error(data?.error || 'Veo returned no video');
            await addVideoAsset(data.base64, true, 'veo_img2video_' + videoRatio.replace(':', 'x'));
            setVideoPrompt('');
            return;
          }
        }
      }
      const vr = await base44.integrations.Core.GenerateVideo({
        prompt: prompt +
          '. Professional food advertising style, appetizing, studio lighting, no people, no text overlay.',
        duration: 6,
        aspect_ratio: videoRatio,
      });
      await addVideoAsset(vr.url, false, 'ai_video_' + videoRatio.replace(':', 'x'));
      setVideoPrompt('');
    } catch (e) {
      const msg = (e && e.message) || 'Video generation failed';
      if (/429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
        setGenError('Google AI Studio quota or rate limit exceeded — Veo is a paid model. Please top up your AI Studio billing credits at aistudio.google.com and try again in a minute.');
      } else {
        setGenError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  // AI-recompose the first uploaded image into every ad ratio via OpenAI
  // gpt-image-1 (the model behind ChatGPT's image gen): keeps ALL elements and
  // rearranges them into a sharp new frame for each aspect ratio.
  const generateAllRatios = async () => {
    if (!firstImage) return;
    setBusy(true);
    setGenError(null);
    try {
      const blob = await (await fetch(firstImage.base64)).blob();
      const fileObj = new File([blob], firstImage.name || 'source.jpg', { type: 'image/jpeg' });
      const up = await base44.integrations.Core.UploadFile({ file: fileObj });
      const srcUrl = up.file_url;

      const existingImageRatios = new Set(assets.filter((a) => a.kind === 'image').map((a) => a.ratio));
      const targets = ASSET_RATIOS.filter((r) => !existingImageRatios.has(r.value));
      if (targets.length === 0) {
        setGenError('All ratios already have images — nothing to generate.');
        return;
      }
      const results = await Promise.all(targets.map(async (r) => {
        try {
          const res = await base44.functions.invoke('openaiImageGen', {
            sourceUrl: srcUrl,
            ratio: r.value,
            w: r.w,
            h: r.h,
            label: r.label,
          });
          const data = res?.data;
          if (!data?.base64) throw new Error(data?.error || 'No image returned');
          return { ratio: r.value, kind: 'image', base64: data.base64, name: 'ai_' + r.value.replace(':', 'x') + '.png' };
        } catch (e) {
          return { error: r.value + ': ' + ((e && e.message) || 'failed') };
        }
      }));

      const generated = results.filter((x) => x && !x.error);
      const errors = results.filter((x) => x && x.error);
      if (generated.length === 0) throw new Error(errors[0]?.error || 'All ratios failed');
      onAssets([...assets, ...generated]);
      if (errors.length > 0) setGenError(errors.map((e) => e.error).join('; '));
    } catch (e) {
      setGenError((e && e.message) || 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  // Regenerate a single image for a specific ratio using a chat instruction.
  // Uses the original source image (firstImage) and the user's text guidance.
  const regenerateImage = async () => {
    if (chatTargetIdx === null || !chatPrompt.trim()) return;
    const target = assets[chatTargetIdx];
    if (!target || target.kind !== 'image') return;
    const source = firstImage || target;
    setBusy(true);
    setGenError(null);
    try {
      let srcUrl = source.url;
      if (!srcUrl && source.base64) {
        const blob = await (await fetch(source.base64)).blob();
        const fileObj = new File([blob], source.name || 'source.jpg', { type: 'image/jpeg' });
        const up = await base44.integrations.Core.UploadFile({ file: fileObj });
        srcUrl = up.file_url;
      }
      if (!srcUrl) throw new Error('No source image available');
      const ratioDef = ASSET_RATIOS.find((r) => r.value === target.ratio);
      const res = await base44.functions.invoke('openaiImageGen', {
        sourceUrl: srcUrl,
        ratio: target.ratio,
        w: ratioDef?.w,
        h: ratioDef?.h,
        label: ratioDef?.label,
        prompt: chatPrompt.trim(),
      });
      const data = res?.data;
      if (!data?.base64) throw new Error(data?.error || 'No image returned');
      const next = [...assets];
      next[chatTargetIdx] = {
        ratio: target.ratio,
        kind: 'image',
        base64: data.base64,
        name: 'ai_fix_' + target.ratio.replace(':', 'x') + '.png',
      };
      onAssets(next);
      setChatTargetIdx(null);
      setChatPrompt('');
    } catch (e) {
      setGenError((e && e.message) || 'Regeneration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label>Media — all ratios</Label>
      <p className="text-xs text-muted-foreground">
        Load one image, then let AI re-compose it into every ratio (not a crop) — or manually add
        images/videos in any ratio. Videos keep their native ratio.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="cursor-pointer">
          <span className="inline-flex items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm hover:bg-accent">
            <Upload className="h-4 w-4" /> Add images
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { addFiles('image', Array.from(e.target.files || [])); e.target.value = ''; }}
          />
        </label>
        <label className="cursor-pointer">
          <span className="inline-flex items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm hover:bg-accent">
            <Video className="h-4 w-4" /> Add videos
          </span>
          <input
            type="file"
            accept="video/mp4,video/*"
            multiple
            className="hidden"
            onChange={(e) => { addFiles('video', Array.from(e.target.files || [])); e.target.value = ''; }}
          />
        </label>
        {firstImage && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-9"
            disabled={busy}
            onClick={generateAllRatios}
          >
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {busy ? 'Recomposing…' : 'Generate missing ratios (ChatGPT)'}
          </Button>
        )}
        {assets.length > 0 && (
          <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => onAssets([])}>
            Clear all
          </Button>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9"
        onClick={() => setShowVideoGen((v) => !v)}
      >
        <Film className="h-4 w-4 mr-2" /> {showVideoGen ? 'Hide AI video generator' : 'AI video from text prompt'}
      </Button>

      {showVideoGen && (
        <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Film className="h-4 w-4" /> AI video from text prompt
          </div>

          {/* Brand logo — appended as an outro card on every generated video */}
          <div className="flex items-center gap-3 flex-wrap rounded-md bg-background/60 p-2 border border-border/50">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ImagePlus className="h-3.5 w-3.5" /> Brand logo outro:
            </span>
            {logoUrl ? (
              <div className="flex items-center gap-2">
                <img src={logoUrl} alt="Logo" className="h-8 w-8 object-contain rounded border bg-white/50" />
                <span className="text-xs text-muted-foreground">Logo will appear at the end</span>
                <label className="cursor-pointer">
                  <span className="text-xs text-primary hover:underline">Replace</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { uploadLogo(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
                <button type="button" className="text-xs text-destructive hover:underline" onClick={removeLogo}>
                  Remove
                </button>
              </div>
            ) : (
              <label className="cursor-pointer">
                <span className="inline-flex items-center gap-1.5 text-xs rounded-md border border-input bg-transparent px-2.5 py-1.5 hover:bg-accent">
                  {logoUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {logoUploading ? 'Uploading…' : 'Upload brand logo'}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => { uploadLogo(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>
            )}
          </div>

          <Textarea
            placeholder="Describe the motion, e.g. 'steam rising off a fresh Hellcrust pizza, slow push-in, melted cheese stretch'"
            value={videoPrompt}
            onChange={(e) => setVideoPrompt(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={useStartImage}
                onCheckedChange={(v) => { setUseStartImage(!!v); if (v && startImageIdx === '' && imageAssets.length) setStartImageIdx(String(imageAssets[0].i)); }}
              />
              <span className="flex items-center gap-1"><ImagePlus className="h-3.5 w-3.5" /> Start from an existing image</span>
            </label>
            {useStartImage && (
              <Select value={startImageIdx} onValueChange={setStartImageIdx}>
                <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Pick a source image" /></SelectTrigger>
                <SelectContent>
                  {imageAssets.map(({ a, i }) => (
                    <SelectItem key={i} value={String(i)}>{a.name || ('image-' + i)} · {a.ratio}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select value={videoRatio} onValueChange={setVideoRatio}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VEO_RATIOS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label} · {r.note}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={busy || !videoPrompt.trim() || (useStartImage && !startImageIdx)}
              onClick={generateVideo}
            >
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {busy ? 'Generating video…' : 'Generate video'}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              ~30–60s · 6s clip · uses AI credits{logoUrl ? ' · +logo outro' : ''}
            </span>
          </div>
        </div>
      )}

      {genError && (
        <p className="text-xs text-destructive">{genError}</p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto p-1">
          {TABS.map((t) => {
            const count = assets.filter((a) => a.ratio === t.ratio && a.kind === t.kind).length;
            return (
              <TabsTrigger key={t.key} value={t.key} className="text-xs gap-1">
                {t.label}{count > 0 ? <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px]">{count}</span> : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {TABS.map((t) => {
          const items = assets
            .map((a, i) => ({ a, i }))
            .filter(({ a }) => a.ratio === t.ratio && a.kind === t.kind);
          return (
            <TabsContent key={t.key} value={t.key} className="mt-3">
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">No {t.kind}s in this ratio yet — add one above.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {items.map(({ a, i }) => (
                    <div
                      key={i}
                      className="relative h-28 rounded-md overflow-hidden border bg-muted cursor-zoom-in"
                      style={{ aspectRatio: a.ratio.replace(':', ' / ') }}
                      onDoubleClick={() => setPreview(a)}
                      title="Double-click to view"
                    >
                      {a.kind === 'image' ? (
                        <img src={a.base64 || a.url} alt={a.name} className="w-full h-full object-contain pointer-events-none" />
                      ) : (
                        <video src={a.base64 || a.url} className="w-full h-full object-contain pointer-events-none" muted />
                      )}
                      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 text-center">
                        {a.ratio}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      {a.kind === 'image' && (
                        <button
                          type="button"
                          onClick={() => { setChatTargetIdx(i); setChatPrompt(''); }}
                          className="absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-primary"
                          title="Fix with AI"
                        >
                          <Sparkles className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent
          className="max-w-3xl"
          style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0 }}
        >
          <DialogTitle className="sr-only">{preview?.name || 'Asset preview'}</DialogTitle>
          <div className="flex justify-center">
            {preview?.kind === 'image' ? (
              <img
                src={preview.base64 || preview.url}
                alt={preview.name}
                className="max-w-full max-h-[80vh] rounded-md"
              />
            ) : preview?.kind === 'video' ? (
              <video
                src={preview.base64 || preview.url}
                className="max-w-full max-h-[80vh] rounded-md"
                controls
                autoPlay
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={chatTargetIdx !== null} onOpenChange={(o) => { if (!o) { setChatTargetIdx(null); setChatPrompt(''); } }}>
        <DialogContent className="max-w-md">
          <DialogTitle>Fix image with AI{chatTargetIdx !== null && assets[chatTargetIdx] ? ' · ' + assets[chatTargetIdx].ratio : ''}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Tell the AI what to change for this image. It uses the original source photo and your instructions to regenerate it.
          </p>
          <Textarea
            placeholder="e.g. make the pizza more centered, brighten the lighting, add more steam"
            value={chatPrompt}
            onChange={(e) => setChatPrompt(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setChatTargetIdx(null); setChatPrompt(''); }}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy || !chatPrompt.trim()} onClick={regenerateImage}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {busy ? 'Regenerating…' : 'Regenerate'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function getVideoRatio(dataUrl) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.onloadedmetadata = () => {
      const ar = v.videoWidth / v.videoHeight;
      let best = VIDEO_RATIOS[0];
      let bestDiff = Infinity;
      for (const r of VIDEO_RATIOS) {
        const [rw, rh] = r.value.split(':').map(Number);
        const diff = Math.abs(ar - rw / rh);
        if (diff < bestDiff) { bestDiff = diff; best = r; }
      }
      resolve(best.value);
    };
    v.onerror = () => resolve('9:16');
    v.src = dataUrl;
  });
}

function detectRatio(file) {
  if (file.type && file.type.startsWith('video')) return '9:16';
  return '1:1';
}