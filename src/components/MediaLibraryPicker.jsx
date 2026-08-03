import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Images, Film, Check, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const ratioLabel = (w, h) => {
  if (!w || !h) return '';
  const target = w / h;
  const standards = [
    [1, 1], [4, 5], [5, 4], [9, 16], [16, 9], [4, 3], [3, 4],
    [2, 3], [3, 2], [1.91, 1], [1, 1.91], [2, 1], [1, 2],
  ];
  let best = null;
  let bestDiff = Infinity;
  for (const [rw, rh] of standards) {
    const diff = Math.abs(target - rw / rh);
    if (diff < bestDiff) { bestDiff = diff; best = `${rw}:${rh}`; }
  }
  if (bestDiff < 0.04) return best;
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
};

export default function MediaLibraryPicker({ account, onAdd }) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [tab, setTab] = useState('images');

  const load = async (actId) => {
    setLoading(true);
    setError(null);
    try {
      const [mediaRes, vidRes] = await Promise.all([
        base44.functions.invoke('metaAds', { action: 'list_media', account_id: actId })
          .catch(() => ({ data: { media: [] } })),
        base44.functions.invoke('metaAds', { action: 'list_videos', account_id: actId })
          .catch(() => ({ data: { videos: [] } })),
      ]);
      setMedia(mediaRes.data?.media || []);
      setVideos(vidRes.data?.videos || []);
    } catch (e) {
      setError(e.message || 'Failed to load media');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && account && !media.length && !videos.length && !loading) {
      load(account.account_id || account.id);
    }
  }, [open]);

  const toggle = (key) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleAdd = () => {
    const picked = [];
    for (const m of media) {
      const key = `img:${m.hash}`;
      if (selected.has(key)) {
        picked.push({
          kind: 'image',
          image_hash: m.hash,
          name: m.name || m.hash.slice(0, 8),
          ratio: ratioLabel(m.width, m.height),
        });
      }
    }
    for (const v of videos) {
      const key = `vid:${v.id}`;
      if (selected.has(key)) {
        picked.push({
          kind: 'video',
          video_id: v.id,
          name: v.title || v.id,
          ratio: ratioLabel(v.width, v.height),
        });
      }
    }
    if (picked.length) onAdd(picked);
    setSelected(new Set());
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader
        className="flex-row items-center justify-between space-y-0 cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Images className="h-4 w-4" /> Use media from your library
          </CardTitle>
          <CardDescription className="text-xs mt-1">
            Pick images or videos already uploaded to your ad account — no re-upload needed.
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" type="button" className="h-8 w-8 shrink-0">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading library…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-4 text-center">{error}</p>
          ) : (
            <>
              <div className="flex gap-1 border-b">
                <button
                  type="button"
                  onClick={() => setTab('images')}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium border-b-2 transition-colors',
                    tab === 'images' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
                  )}
                >
                  Images ({media.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTab('videos')}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium border-b-2 transition-colors',
                    tab === 'videos' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
                  )}
                >
                  Videos ({videos.length})
                </button>
              </div>

              {tab === 'images' && (
                media.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No images in your library. Upload some in the Media page first.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    {media.map((m) => {
                      const key = `img:${m.hash}`;
                      const isSel = selected.has(key);
                      return (
                        <div
                          key={m.hash}
                          className={cn(
                            'group relative aspect-square overflow-hidden rounded-lg border bg-muted cursor-pointer',
                            isSel ? 'ring-2 ring-primary border-primary' : 'border-border'
                          )}
                          onClick={() => toggle(key)}
                        >
                          <img src={m.url} alt={m.name || 'image'} loading="lazy" className="h-full w-full object-cover" />
                          {ratioLabel(m.width, m.height) && (
                            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                              {ratioLabel(m.width, m.height)}
                            </span>
                          )}
                          <span className={cn(
                            'absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded border-2 transition-colors',
                            isSel ? 'bg-primary border-primary text-primary-foreground' : 'bg-black/30 border-white/70 text-transparent'
                          )}>
                            <Check className="h-3 w-3" />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {tab === 'videos' && (
                videos.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No videos in your library. Upload some in the Media page first.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {videos.map((v) => {
                      const key = `vid:${v.id}`;
                      const isSel = selected.has(key);
                      return (
                        <div
                          key={v.id}
                          className={cn(
                            'group relative aspect-video overflow-hidden rounded-lg border bg-muted cursor-pointer',
                            isSel ? 'ring-2 ring-primary border-primary' : 'border-border'
                          )}
                          onClick={() => toggle(key)}
                        >
                          {v.thumbnail_url ? (
                            <img src={v.thumbnail_url} alt={v.title || 'video'} loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <Film className="h-6 w-6" />
                            </div>
                          )}
                          <span className="absolute top-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">VIDEO</span>
                          {ratioLabel(v.width, v.height) && (
                            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                              {ratioLabel(v.width, v.height)}
                            </span>
                          )}
                          <span className={cn(
                            'absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded border-2 transition-colors',
                            isSel ? 'bg-primary border-primary text-primary-foreground' : 'bg-black/30 border-white/70 text-transparent'
                          )}>
                            <Check className="h-3 w-3" />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {selected.size > 0 && (
                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <span className="text-sm text-muted-foreground">{selected.size} selected</span>
                  <Button type="button" size="sm" onClick={handleAdd}>
                    <Plus className="h-4 w-4" /> Add to ad
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}