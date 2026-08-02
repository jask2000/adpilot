import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Images, Check, Trash2, Upload, ShieldCheck, Video, Film } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Media() {
  const [media, setMedia] = useState([]);
  const [videos, setVideos] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyType, setBusyType] = useState(null); // 'image' | 'video' | null
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [selectedVideos, setSelectedVideos] = useState(new Set());
  const [usedHashes, setUsedHashes] = useState(new Set());
  const [delProgress, setDelProgress] = useState(null);
  const fileRef = useRef(null);
  const videoRef = useRef(null);

  const loadMedia = async (actId) => {
    const [mediaRes, usedRes, vidRes] = await Promise.all([
      base44.functions.invoke('metaAds', { action: 'list_media', account_id: actId }),
      base44.functions.invoke('metaAds', { action: 'list_used_image_hashes', account_id: actId })
        .catch(() => ({ data: { hashes: [] } })),
      base44.functions.invoke('metaAds', { action: 'list_videos', account_id: actId })
        .catch(() => ({ data: { videos: [] } })),
    ]);
    setMedia(mediaRes.data?.media || []);
    setUsedHashes(new Set(usedRes.data?.hashes || []));
    setVideos(vidRes.data?.videos || []);
    setSelectedVideos(new Set());
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

  const toggleVideo = (id) =>
    setSelectedVideos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAllVideos = () => setSelectedVideos(new Set(videos.map((v) => v.id)));
  const clearVideos = () => setSelectedVideos(new Set());

  const handleDeleteVideo = async (v) => {
    if (!confirm(`Delete video "${v.title || v.id}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await base44.functions.invoke('metaAds', { action: 'delete_video', account_id: accountId, video_id: v.id });
      setSelectedVideos((prev) => { const n = new Set(prev); n.delete(v.id); return n; });
      await loadMedia(accountId);
    } catch (e) {
      setError(e.message || 'Video delete failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSelectedVideos = async () => {
    const count = selectedVideos.size;
    if (!count) return;
    if (!confirm(`Delete ${count} selected video${count > 1 ? 's' : ''}?`)) return;
    setBusy(true);
    setError(null);
    const ids = Array.from(selectedVideos);
    try {
      for (const id of ids) {
        await base44.functions.invoke('metaAds', { action: 'delete_video', account_id: accountId, video_id: id });
      }
      setSelectedVideos(new Set());
      await loadMedia(accountId);
    } catch (e) {
      setError(e.message || 'Video delete failed');
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setBusyType('image');
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
      setBusyType(null);
    }
  };

  const handleVideoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setBusyType('video');
    setError(null);
    try {
      for (const file of files) {
        // Upload to hosted storage first, then pass the URL to the backend so
        // the video bytes are fetched server-side — sending large base64 video
        // payloads through the backend gateway exceeds request-size limits.
        const up = await base44.integrations.Core.UploadFile({ file });
        await base44.functions.invoke('metaAds', {
          action: 'upload_video',
          account_id: accountId,
          video_url: up.file_url,
          video_filename: file.name,
          title: file.name.replace(/\.[^.]+$/, ''),
        });
      }
      await loadMedia(accountId);
    } catch (e) {
      setError(e.message || 'Video upload failed');
    } finally {
      setBusy(false);
      setBusyType(null);
    }
  };

  const fmtDuration = (secs) => {
    if (!secs || isNaN(secs)) return '';
    const s = Math.round(secs);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  const runDelete = async (hashes) => {
    const res = await base44.functions.invoke('metaAds', { action: 'delete_media', account_id: accountId, hashes });
    const data = res.data || {};
    const failedHashes = (data.results || []).filter((r) => r.status !== 'deleted').map((r) => r.hash);
    const blockedCount = data.blocked || 0;
    const errorCount = data.errors || 0;
    let msg = '';
    if (blockedCount) msg += `${blockedCount} image(s) are used by an active ad and were skipped. `;
    if (errorCount) {
      const firstErr = (data.results || []).find((r) => r.status === 'error');
      msg += `${errorCount} image(s) failed${firstErr ? `: ${firstErr.reason}` : ''}.`;
    }
    return { failedHashes, msg: msg.trim() };
  };

  const handleDelete = async (m) => {
    if (!confirm(`Delete "${m.name || m.hash.slice(0, 8)}"? Any paused or archived ads and creatives using this image will also be deleted so Meta allows the deletion. Ads that are currently active are left untouched.`)) return;
    setBusy(true);
    setError(null);
    try {
      const { failedHashes, msg } = await runDelete([m.hash]);
      if (msg) setError(msg);
      setSelected((prev) => {
        const next = new Set(prev);
        if (!failedHashes.includes(m.hash)) next.delete(m.hash);
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
    if (!confirm(`Delete ${count} selected image${count > 1 ? 's' : ''}? Any paused or archived ads and creatives using these images will also be deleted so Meta allows the deletion. Ads that are currently active are left untouched.`)) return;
    setBusy(true);
    setError(null);
    setDelProgress({ done: 0, total: count });
    const hashes = Array.from(selected);
    try {
      setDelProgress({ done: 1, total: count });
      const { failedHashes, msg } = await runDelete(hashes);
      setSelected(new Set(failedHashes));
      if (msg) setError(msg);
      await loadMedia(accountId);
    } catch (e) {
      setError(e.message || 'Delete failed');
    } finally {
      setDelProgress(null);
      setBusy(false);
    }
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
        <div className="flex items-center gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={busy || !accountId}>
            {busyType === 'image' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busyType === 'image' ? 'Uploading…' : 'Upload images'}
          </Button>
          <Button variant="outline" onClick={() => videoRef.current?.click()} disabled={busy || !accountId}>
            {busyType === 'video' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            {busyType === 'video' ? 'Uploading…' : 'Upload videos'}
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
        <input
          ref={videoRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={handleVideoUpload}
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
                    {ratioLabel(m.width, m.height) && (
                      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {ratioLabel(m.width, m.height)}
                      </span>
                    )}
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

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Film className="h-5 w-5" /> Uploaded videos
            </CardTitle>
            <CardDescription>
              {selectedVideos.size > 0
                ? `${selectedVideos.size} of ${videos.length} selected`
                : `${videos.length} video${videos.length === 1 ? '' : 's'} available`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={selectAllVideos} disabled={!videos.length}>
              Select all
            </Button>
            <Button variant="outline" size="sm" onClick={clearVideos} disabled={!selectedVideos.size}>
              Clear
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelectedVideos}
              disabled={!selectedVideos.size || busy}
            >
              <Trash2 className="h-4 w-4" />
              Delete selected ({selectedVideos.size})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading videos…
            </div>
          ) : videos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">
              No uploaded videos found. Click “Upload videos” to add some.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {videos.map((v) => {
                const isSel = selectedVideos.has(v.id);
                return (
                  <div
                    key={v.id}
                    className={cn(
                      'group relative aspect-video overflow-hidden rounded-lg border bg-muted',
                      isSel ? 'ring-2 ring-primary border-primary' : 'border-border'
                    )}
                  >
                    {v.thumbnail_url ? (
                      <img
                        src={v.thumbnail_url}
                        alt={v.title || 'ad video'}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <Film className="h-8 w-8" />
                      </div>
                    )}
                    <span className="absolute top-1.5 left-9 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      VIDEO
                    </span>
                    {ratioLabel(v.width, v.height) && (
                      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {ratioLabel(v.width, v.height)}
                      </span>
                    )}
                    {v.length != null && (
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {fmtDuration(v.length)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleVideo(v.id)}
                      className="absolute inset-0"
                      title="Select"
                    />
                    <span
                      className={cn(
                        'absolute top-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-md border-2 transition-colors z-10',
                        isSel
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'bg-black/30 border-white/70 text-transparent group-hover:border-white'
                      )}
                    >
                      <Check className="h-4 w-4" />
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteVideo(v)}
                      disabled={busy}
                      title="Delete video"
                      className="absolute top-1.5 right-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white hover:bg-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {v.title && (
                      <span className="absolute bottom-0 inset-x-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        {v.title}
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