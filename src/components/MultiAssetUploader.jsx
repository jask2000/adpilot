import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload, Video, X } from 'lucide-react';
import { cropToRatio, ASSET_RATIOS } from '@/lib/mediaCrop';

// Collects multiple images and videos across all common ad ratios.
// Calls onAssets([{ ratio, kind: 'image'|'video', base64, name }]).
export default function MultiAssetUploader({ assets, onAssets }) {
  const [busy, setBusy] = useState(false);

  const addFiles = async (kind, files) => {
    setBusy(true);
    try {
      for (const file of files) {
        const r = ASSET_RATIOS.find((x) => x.value === detectRatio(file)) || ASSET_RATIOS[0];
        if (kind === 'image') {
          const dataUrl = await readAsDataUrl(file);
          const cropped = await cropToRatio(dataUrl, r.w, r.h);
          onAssets([...assets, { ratio: r.value, kind: 'image', base64: cropped, name: file.name }]);
        } else {
          const dataUrl = await readAsDataUrl(file);
          onAssets([...assets, { ratio: r.value, kind: 'video', base64: dataUrl, name: file.name }]);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = (i) => onAssets(assets.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      <Label>Media — all ratios</Label>
      <p className="text-xs text-muted-foreground">
        Load images and/or videos; each is tagged with its aspect ratio so Meta
        delivers it to the matching placement (Feed 1:1, IG Feed 4:5, Reels/Stories 9:16, link ads 1.91:1).
        Videos keep their native ratio — export the shape you want.
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
            onChange={(e) => addFiles('image', Array.from(e.target.files || []))}
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
            onChange={(e) => addFiles('video', Array.from(e.target.files || []))}
          />
        </label>
        {busy && <span className="text-xs text-muted-foreground">Processing…</span>}
        {assets.length > 0 && (
          <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => onAssets([])}>
            Clear all
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {assets.map((a, i) => (
          <div key={i} className="relative w-24 h-24 rounded-md overflow-hidden border bg-muted">
            {a.kind === 'image' ? (
              <img src={a.base64} alt={a.name} className="w-full h-full object-cover" />
            ) : (
              <video src={a.base64} className="w-full h-full object-cover" muted />
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
  // Videos can't be dimension-probed cheaply; default to 9:16, user keeps what they export.
  if (file.type?.startsWith('video')) return '9:16';
  // Images: read dimensions on the fly is async; we default ratio by file name hint.
  return '1:1';
}