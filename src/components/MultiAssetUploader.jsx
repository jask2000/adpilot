import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload, Video, X, Sparkles, Loader2, Film } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';
import { cropToRatio, ASSET_RATIOS } from '@/lib/mediaCrop';

const VIDEO_RATIOS = [
  { value: '9:16', ar: '9:16', label: '9:16 (Stories / Reels)' },
  { value: '16:9', ar: '16:9', label: '16:9 (Landscape)' },
];

// Collects multiple images and videos across all common ad ratios.
// Calls onAssets([{ ratio, kind: 'image'|'video', base64?, url?, name }]).
export default function MultiAssetUploader({ assets, onAssets }) {
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoRatio, setVideoRatio] = useState('9:16');
  const [showVideoGen, setShowVideoGen] = useState(false);
  const [preview, setPreview] = useState(null);

  const firstImage = assets.find((a) => a.kind === 'image');

  const addFiles = async (kind, files) => {
    setBusy(true);
    try {
      const next = [...assets];
      for (const file of files) {
        const r = ASSET_RATIOS.find((x) => x.value === detectRatio(file)) || ASSET_RATIOS[0];
        if (kind === 'image') {
          const dataUrl = await readAsDataUrl(file);
          const cropped = await cropToRatio(dataUrl, r.w, r.h);
          next.push({ ratio: r.value, kind: 'image', base64: cropped, name: file.name });
        } else {
          const dataUrl = await readAsDataUrl(file);
          next.push({ ratio: r.value, kind: 'video', base64: dataUrl, name: file.name });
        }
      }
      onAssets(next);
    } finally {
      setBusy(false);
    }
  };

  const remove = (i) => onAssets(assets.filter((_, idx) => idx !== i));

  // AI-generate a video from a text prompt (Veo). Adds one 6s video asset.
  const generateVideo = async () => {
    if (!videoPrompt.trim()) return;
    setBusy(true);
    setGenError(null);
    try {
      const vr = await base44.integrations.Core.GenerateVideo({
        prompt: videoPrompt.trim() +
          '. Professional food advertising style, appetizing, studio lighting, no people, no text overlay.',
        duration: 6,
        aspect_ratio: videoRatio,
      });
      onAssets([
        ...assets,
        { ratio: videoRatio, kind: 'video', url: vr.url, name: 'ai_video_' + videoRatio.replace(':', 'x') + '.mp4' },
      ]);
      setVideoPrompt('');
    } catch (e) {
      setGenError((e && e.message) || 'Video generation failed');
    } finally {
      setBusy(false);
    }
  };

  // AI-generate each ratio from the first uploaded image (recompose, not crop).
  const generateAllRatios = async () => {
    if (!firstImage) return;
    setBusy(true);
    setGenError(null);
    try {
      // 1. Upload the source image so GenerateImage can reference it by URL.
      const blob = await (await fetch(firstImage.base64)).blob();
      const fileObj = new File([blob], firstImage.name || 'source.jpg', { type: 'image/jpeg' });
      const up = await base44.integrations.Core.UploadFile({ file: fileObj });
      const srcUrl = up.file_url;

      // 2. Generate each ratio with the source as style/content reference.
      const generated = [];
      for (const r of ASSET_RATIOS) {
        const prompt =
          'Professional food advertising photo re-composed for a ' + r.value + ' (' + r.label + ') aspect ratio. ' +
          'Keep the same product, plating, and styling as the reference image — do NOT crop; re-frame with ' +
          (r.h > r.w ? 'vertical negative space for ad copy' : r.value === '1.91:1' ? 'wide horizontal composition with text space' : 'balanced square framing') +
          '. High-end studio lighting, appetizing, sharp, no people, no text overlay.';
        const gi = await base44.integrations.Core.GenerateImage({
          prompt,
          existing_image_urls: [srcUrl],
        });
        generated.push({ ratio: r.value, kind: 'image', url: gi.url, name: 'ai_' + r.value.replace(':', 'x') + '.jpg' });
      }

      // 3. Replace existing image assets with the generated set (keep any videos).
      onAssets([...assets.filter((a) => a.kind === 'video'), ...generated]);
    } catch (e) {
      setGenError((e && e.message) || 'Generation failed');
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
            {busy ? 'Generating…' : 'Generate all ratios (AI)'}
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
          <Textarea
            placeholder="Describe the motion, e.g. 'steam rising off a fresh Hellcrust pizza, slow push-in, melted cheese stretch'"
            value={videoPrompt}
            onChange={(e) => setVideoPrompt(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <div className="flex items-center gap-2">
            <Select value={videoRatio} onValueChange={setVideoRatio}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VIDEO_RATIOS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={busy || !videoPrompt.trim()}
              onClick={generateVideo}
            >
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {busy ? 'Generating video…' : 'Generate video'}
            </Button>
            <span className="text-[11px] text-muted-foreground">~30–60s · 6s clip · uses AI credits</span>
          </div>
        </div>
      )}

      {genError && (
        <p className="text-xs text-destructive">{genError}</p>
      )}
      <div className="flex flex-wrap gap-3">
        {assets.map((a, i) => (
          <div
            key={i}
            className="relative w-24 h-24 rounded-md overflow-hidden border bg-muted cursor-zoom-in"
            onDoubleClick={() => setPreview(a)}
            title="Double-click to view"
          >
            {a.kind === 'image' ? (
              <img src={a.base64 || a.url} alt={a.name} className="w-full h-full object-cover pointer-events-none" />
            ) : (
              <video src={a.base64 || a.url} className="w-full h-full object-cover pointer-events-none" muted />
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
          </div>
        ))}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-w-3xl p-2">
          <DialogTitle className="sr-only">{preview?.name || 'Asset preview'}</DialogTitle>
          {preview?.kind === 'image' ? (
            <img
              src={preview.base64 || preview.url}
              alt={preview.name}
              className="w-full h-auto max-h-[80vh] object-contain rounded-md"
            />
          ) : preview?.kind === 'video' ? (
            <video
              src={preview.base64 || preview.url}
              className="w-full h-auto max-h-[80vh] object-contain rounded-md"
              controls
              autoPlay
            />
          ) : null}
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

function detectRatio(file) {
  if (file.type && file.type.startsWith('video')) return '9:16';
  return '1:1';
}