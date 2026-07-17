import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Loader2,
  ImagePlus,
  X,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

const RATIOS = [
  { value: '1:1', label: '1:1 · Feed', w: 1, h: 1 },
  { value: '4:5', label: '4:5 · Instagram Feed', w: 4, h: 5 },
  { value: '9:16', label: '9:16 · Stories / Reels', w: 9, h: 16 },
  { value: '1.91:1', label: '1.91:1 · Link ads', w: 1.91, h: 1 },
];

export default function AddVariantsDialog({ accountId, campaign, open, onOpenChange }) {
  const [images, setImages] = useState([]);
  const [ratio, setRatio] = useState('1:1');
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const reset = () => {
    setImages([]);
    setHeadline('');
    setMessage('');
    setActive(false);
    setResult(null);
    setError(null);
  };

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
    setImages((prev) => [...prev, ...items]);
  };

  const submit = async () => {
    if (!images.length) {
      setError('Upload at least one image.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke('metaAds', {
        action: 'add_variants',
        account_id: accountId,
        campaign_id: campaign.id,
        variant_images: images.map((i) => i.url),
        headline: headline || undefined,
        message: message || undefined,
        status: active ? 'ACTIVE' : 'PAUSED',
      });
      setResult(res.data);
      if (res.data.success) {
        setImages([]);
        setHeadline('');
        setMessage('');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add image variants · {campaign?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-xs text-muted-foreground">
            Upload one or more images to create new ad variants inside this
            campaign. Each becomes a separate ad under its ad set, cloned from an
            existing ad's creative (link, call-to-action, page). Leave headline /
            message blank to keep the original copy.
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs">Aspect ratio</Label>
            <Select value={ratio} onValueChange={setRatio}>
              <SelectTrigger className="w-full h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATIOS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Images</Label>
            <div className="flex flex-wrap gap-2">
              {images.map((p, i) => (
                <div
                  key={i}
                  className="relative w-20 h-20 rounded-md overflow-hidden border bg-muted"
                >
                  <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      setImages((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-input text-muted-foreground hover:bg-accent">
                <ImagePlus className="h-5 w-5" />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePick}
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Headline (optional, all variants)</Label>
              <Input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Keep original"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Message (optional, all variants)</Label>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Keep original"
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-2.5">
            <div>
              <Label className="text-sm">Launch active</Label>
              <p className="text-xs text-muted-foreground">
                Off = create paused (review before spending). On = run immediately
                alongside existing ads.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
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
                Created {result.created} of {result.total} variant(s) —{' '}
                {result.status === 'ACTIVE' ? 'active' : 'paused'}.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={submit} disabled={busy || !images.length}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <ImagePlus className="h-4 w-4 mr-2" />
                Add {images.length || ''} variant{images.length === 1 ? '' : 's'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}