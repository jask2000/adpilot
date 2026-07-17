import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Images, Check, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Media() {
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    (async () => {
      try {
        let actId = '';
        const cfgs = await base44.entities.AppConfig.list();
        if (cfgs[0]?.selected_ad_account_id) {
          actId = cfgs[0].selected_ad_account_id;
        } else {
          const res = await base44.functions.invoke('metaAds', { action: 'list_accounts' });
          actId = res.data?.accounts?.[0]?.account_id || res.data?.accounts?.[0]?.id || '';
        }
        if (!actId) {
          setError('No ad account found.');
          setLoading(false);
          return;
        }
        const res2 = await base44.functions.invoke('metaAds', { action: 'list_media', account_id: actId });
        setMedia(res2.data?.media || []);
      } catch (e) {
        setError(e.message || 'Failed to load media');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = (hash) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });

  const selectAll = () => setSelected(new Set(media.map((m) => m.hash)));
  const clear = () => setSelected(new Set());

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
          <Images className="h-6 w-6" /> Media Library
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select uploaded ad images from your account. You can pick multiple.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Uploaded images</CardTitle>
            <CardDescription>
              {selected.size > 0
                ? `${selected.size} of ${media.length} selected`
                : `${media.length} images available`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={selectAll} disabled={!media.length}>
              Select all
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clear}
              disabled={!selected.size}
            >
              <Trash2 className="h-4 w-4" /> Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading media…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-8 text-center">{error}</p>
          ) : media.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">
              No uploaded images found for this account.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {media.map((m) => {
                const isSel = selected.has(m.hash);
                return (
                  <button
                    key={m.hash}
                    type="button"
                    onClick={() => toggle(m.hash)}
                    className={cn(
                      'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
                      isSel ? 'ring-2 ring-primary border-primary' : 'border-border hover:border-foreground/30'
                    )}
                  >
                    <img
                      src={m.url}
                      alt={m.name || 'ad image'}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span
                      className={cn(
                        'absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-md border-2 transition-colors',
                        isSel
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'bg-black/30 border-white/70 text-transparent group-hover:border-white'
                      )}
                    >
                      <Check className="h-4 w-4" />
                    </span>
                    {isSel && (
                      <span className="absolute bottom-0 inset-x-0 bg-primary/80 text-primary-foreground text-[10px] py-0.5 px-1 truncate">
                        {m.name || m.hash.slice(0, 8)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}