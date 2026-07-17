import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Images, Check, Trash2, Upload, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Media() {
  const [media, setMedia] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [usedHashes, setUsedHashes] = useState(new Set());
  const [delProgress, setDelProgress] = useState(null);
  const fileRef = useRef(null);

  const loadMedia = async (actId) => {
    const [mediaRes, usedRes] = await Promise.all([
      base44.functions.invoke('metaAds', { action: 'list_media', account_id: actId }),
      base44.functions.invoke('metaAds', { action: 'list_used_image_hashes', account_id: actId })
        .catch(() => ({ data: { hashes: [] } })),
    ]);
    setMedia(mediaRes.data?.media || []);
    setUsedHashes(new Set(usedRes.data?.hashes || []));
  };

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
        setAccountId(actId);
        await loadMedia(actId);
      } catch (e) {
        setError(e.message || 'Failed to load media');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isUsed = (hash) => usedHashes.has(hash);

  const toggle = (hash) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else if (!isUsed(hash)) next.add(hash);
      return next;
    });

  const selectAll = () => setSelected(new Set(media.filter((m) => !isUsed(m.hash)).map((m) => m.hash)));
  const selectUnused = () => setSelected(new Set(media.filter((m) => !isUsed(m.hash)).map((m) => m.hash)));
  const clear = () => setSelected(new Set());

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        const b64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await base44.functions.invoke('metaAds', {
          action: 'upload_media',
          account_id: accountId,
          image_base64: b64,
          image_filename: file.name,
        });
      }
      await loadMedia(accountId);
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (m) => {
    if (!confirm(`Delete "${m.name || m.hash.slice(0, 8)}"? This removes it from your ad account.`)) return;
    setBusy(true);
    setError(null);
    try {
      await base44.functions.invoke('metaAds', { action: 'delete_media', account_id: accountId, hash: m.hash });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(m.hash);
        return next;
      });
      await loadMedia(accountId);
    } catch (e) {
      setError(e.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSelected = async () => {
    const count = selected.size;
    if (!count) return;
    if (!confirm(`Delete ${count} selected image${count > 1 ? 's' : ''} from your ad account?`)) return;
    setBusy(true);
    setError(null);
    setDelProgress({ done: 0, total: count });
    const hashes = Array.from(selected);
    let done = 0;
    const results = await Promise.allSettled(
      hashes.map((hash) =>
        base44.functions.invoke('metaAds', { action: 'delete_media', account_id: accountId, hash })
          .finally(() => setDelProgress({ done: ++done, total: count })),
      ),
    );
    const failed = hashes.filter((_, i) => results[i].status === 'rejected');
    const firstReason = results.find((r) => r.status === 'rejected')?.reason?.message
      || results.find((r) => r.status === 'rejected')?.reason?.error
      || '';
    setSelected(new Set(failed));
    setDelProgress(null);
    await loadMedia(accountId);
    if (failed.length) {
      setError(
        `${failed.length} image(s) could not be deleted. ${
          firstReason && /used|creative/i.test(firstReason) ? firstReason : ''
        }`.trim(),
      );
    }
    setBusy(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
            <Images className="h-6 w-6" /> Media Library
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload, delete, and select ad images from your account.
          </p>
        </div>
        <Button onClick={() => fileRef.current?.click()} disabled={busy || !accountId}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload images
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Uploaded images</CardTitle>
            <CardDescription>
              {selected.size > 0
                ? `${selected.size} of ${media.length} selected`
                : `${media.length} images available`}
              {usedHashes.size > 0 ? ` · ${usedHashes.size} in use by active ads` : ''}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={selectUnused} disabled={!media.length}>
              Select unused
            </Button>
            <Button variant="outline" size="sm" onClick={selectAll} disabled={!media.length}>
              Select all deletable
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clear}
              disabled={!selected.size}
            >
              Clear
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelected}
              disabled={!selected.size || busy}
            >
              {busy && delProgress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {busy && delProgress
                ? `Deleting ${delProgress.done}/${delProgress.total}…`
                : `Delete selected (${selected.size})`}
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
              No uploaded images found. Click “Upload images” to add some.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {media.map((m) => {
                const used = isUsed(m.hash);
                const isSel = selected.has(m.hash);
                return (
                  <div
                    key={m.hash}
                    className={cn(
                      'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
                      used ? 'opacity-70 border-border' : isSel ? 'ring-2 ring-primary border-primary' : 'border-border'
                    )}
                  >
                    <img
                      src={m.url}
                      alt={m.name || 'ad image'}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {used ? (
                      <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5">
                        <ShieldCheck className="h-3 w-3" /> In use
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => toggle(m.hash)}
                          className="absolute inset-0"
                          title="Select"
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
                        <button
                          type="button"
                          onClick={() => handleDelete(m)}
                          disabled={busy}
                          title="Delete image"
                          className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white hover:bg-destructive disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    {isSel && (
                      <span className="absolute bottom-0 inset-x-0 bg-primary/80 text-primary-foreground text-[10px] py-0.5 px-1 truncate">
                        {m.name || m.hash.slice(0, 8)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}