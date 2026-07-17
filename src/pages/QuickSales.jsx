import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles, CheckCircle2, AlertCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function QuickSales() {
  const [media, setMedia] = useState([]);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [selectedHash, setSelectedHash] = useState('');
  const [budget, setBudget] = useState('20');
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

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
          setLoadingMedia(false);
          return;
        }
        setAccountId(actId);
        const res = await base44.functions.invoke('metaAds', { action: 'list_media', account_id: actId });
        setMedia(res.data?.media || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoadingMedia(false);
      }
    })();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!selectedHash) {
      setError('Pick an image first.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const today = new Date().toLocaleDateString();
      const res = await base44.functions.invoke('metaAds', {
        action: 'create_ad',
        account_id: accountId,
        objective: 'OUTCOME_SALES',
        campaign_name: `Sales ${today}`,
        ad_name: `Sales Ad ${Date.now()}`,
        daily_budget: budget,
        message: message || 'Check out our offer!',
        link: link || undefined,
        headline: 'Shop Now',
        call_to_action_type: 'SHOP_NOW',
        image_hash: selectedHash,
      });
      setResult(res.data || res);
    } catch (err) {
      setError(err.message || 'Failed to create campaign');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
          <Sparkles className="h-6 w-6" /> Quick Sales Campaign
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick an image, set a budget and link — we handle the rest (objective, creative, pixel, naming).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Choose your media</CardTitle>
          <CardDescription>
            {selectedHash ? 'Image selected' : 'Select one uploaded image for your ad'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingMedia ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading media…
            </div>
          ) : media.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No uploaded images found. Upload one first, or use the full Create Ad page.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {media.map((m) => {
                const isSel = selectedHash === m.hash;
                return (
                  <button
                    key={m.hash}
                    type="button"
                    onClick={() => setSelectedHash(isSel ? '' : m.hash)}
                    className={cn(
                      'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
                      isSel ? 'ring-2 ring-primary border-primary' : 'border-border hover:border-foreground/30'
                    )}
                  >
                    <img src={m.url} alt={m.name || 'ad image'} loading="lazy" className="h-full w-full object-cover" />
                    {isSel && (
                      <span className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Budget &amp; link</CardTitle>
          <CardDescription>Just the essentials — everything else is automatic.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Daily budget ($)</Label>
                <Input
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Website link</Label>
                <Input
                  type="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://yourstore.com/product"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Ad text (optional)</Label>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Check out our offer!"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="break-all">{error}</span>
              </div>
            )}
            {result && (
              <div className="flex items-start gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <div>Sales campaign created (paused). Campaign ID: {result.campaign_id}</div>
                  <div className="text-xs text-muted-foreground">
                    Ad Set: {result.adset_id} · Ad: {result.ad_id}
                  </div>
                </div>
              </div>
            )}

            <Button type="submit" disabled={loading || !selectedHash} size="lg">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create Sales Campaign
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}