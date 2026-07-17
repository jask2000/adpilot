import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, AlertCircle, Wand2, CheckCircle2, ImagePlus, X } from 'lucide-react';

export default function CreativeOptimizer() {
  const [accLoading, setAccLoading] = useState(true);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState([]); // [{ name, url }] data URLs

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke('metaAds', {
          action: 'list_accounts',
        });
        const accs = res.data.accounts || [];
        const cfgs = await base44.entities.AppConfig.list();
        const saved = cfgs[0]?.selected_ad_account_id;
        setAccount(
          accs.find((a) => String(a.account_id) === String(saved)) ||
            accs[0] ||
            null
        );
      } catch (e) {
        setError(e.message);
      } finally {
        setAccLoading(false);
      }
    })();
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke('optimizeCreatives', {
        auto_tune: true,
        generate: true,
        variant_images: picked.map((p) => p.url),
      });
      setResult(res.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
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
    ).then((items) => setPicked((prev) => [...prev, ...items]));
  };

  const removePicked = (i) => setPicked((prev) => prev.filter((_, idx) => idx !== i));

  const thumbMap = {};
  (result?.ads || []).forEach((a) => {
    thumbMap[a.ad_id] = a.thumbnail;
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wand2 className="h-6 w-6" /> Creative Optimizer
          </h1>
          <p className="text-muted-foreground text-sm">
            AI scores your ad creatives, pauses losers, boosts winners, and
            drafts a new image variant.
          </p>
        </div>
        <Button onClick={run} disabled={loading || !account}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Optimizing…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Optimize now
            </>
          )}
        </Button>
      </div>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ImagePlus className="h-4 w-4" /> Your images (optional)
          </div>
          <p className="text-xs text-muted-foreground">
            Upload your own images and the optimizer will build new paused variants from
            the best-performing ad — applying AI-suggested headline/message improvements.
            Leave empty to let the AI generate a variant instead.
          </p>
          <div className="flex flex-wrap gap-3">
            {picked.map((p, i) => (
              <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden border bg-muted">
                <img src={p.url} alt={p.name} className="w-full h-full object-contain" />
                <button
                  type="button"
                  onClick={() => removePicked(i)}
                  className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-input text-muted-foreground hover:bg-accent">
              <ImagePlus className="h-5 w-5" />
              <input type="file" accept="image/*" multiple className="hidden" onChange={handlePick} />
            </label>
          </div>
        </CardContent>
      </Card>

      {accLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {result.summary && (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm whitespace-pre-wrap">{result.summary}</p>
              </CardContent>
            </Card>
          )}

          {result.generated && (
            <Card>
              <CardContent className="py-4 flex items-start gap-2 text-sm">
                {result.generated.ok ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                )}
                <div>
                  {result.generated.ok
                    ? `${result.generated.count || 1} new paused variant(s) created from the best performer.`
                    : `Variant generation failed: ${result.generated.error}`}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3">
            {(result.analyses || []).map((a) => (
              <Card key={a.ad_id}>
                <CardContent className="py-4 flex gap-4">
                  {thumbMap[a.ad_id] && (
                    <img
                      src={thumbMap[a.ad_id]}
                      alt=""
                      className="w-24 h-24 object-contain rounded-md border bg-muted shrink-0"
                    />
                  )}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={
                          a.action === 'pause'
                            ? 'destructive'
                            : a.action === 'boost'
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {a.action}
                      </Badge>
                      <span className="text-sm font-medium">Score: {a.score}</span>
                      {a.generate_variant && (
                        <Badge variant="outline">new variant</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{a.reason}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {result.actions && result.actions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actions taken</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {result.actions.map((x, i) => (
                  <div key={i}>
                    {x.action === 'paused'
                      ? `Paused ad ${x.ad_id}`
                      : `Boosted adset budget to $${(x.new_budget_cents / 100).toFixed(2)} for ad ${x.ad_id}`}
                    {x.error ? ` — error: ${x.error}` : ''}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}