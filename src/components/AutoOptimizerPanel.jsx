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
import { Switch } from '@/components/ui/switch';
import { Loader2, Zap, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function AutoOptimizerPanel({ account }) {
  const [campaigns, setCampaigns] = useState([]);
  const [records, setRecords] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [campRes, recs] = await Promise.all([
        base44.functions.invoke('metaAds', { action: 'list_campaigns', account_id: account.account_id }),
        base44.entities.AutoOptimizer.filter({}),
      ]);
      const map = {};
      for (const r of (recs || [])) map[String(r.campaign_id)] = r;
      setRecords(map);
      setCampaigns(campRes.data?.campaigns || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (account) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const recFor = (c) => records[String(c.id)] || null;

  const toggle = async (c, on) => {
    const existing = recFor(c);
    try {
      if (existing) {
        await base44.entities.AutoOptimizer.update(existing.id, { enabled: on });
      } else {
        await base44.entities.AutoOptimizer.create({
          campaign_id: String(c.id),
          campaign_name: c.name,
          enabled: on,
        });
      }
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const runNow = async (c) => {
    setBusyId(c.id);
    setError(null);
    try {
      await base44.functions.invoke('runAutoOptimizer', { campaign_id: c.id });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!account) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" /> Auto-optimization
        </CardTitle>
        <p className="text-xs text-muted-foreground -mt-2">
          Enable a campaign and AdPilot will run a daily background pass: rank its
          active ad sets by cost-per-click, boost the winner's budget +20%, and
          pause underperformers (CPC above 1.5× the median). Needs ≥ 3 active ad
          sets with at least $5 spend each to act.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
        {!loading && campaigns.length === 0 && (
          <p className="text-sm text-muted-foreground">No campaigns found for this account.</p>
        )}
        <div className="divide-y rounded-md border">
          {campaigns.map((c) => {
            const rec = recFor(c);
            const enabled = !!rec?.enabled;
            return (
              <div key={c.id} className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <Badge variant={c.status === 'ACTIVE' ? 'default' : 'secondary'}>{c.status}</Badge>
                    {enabled && <Badge variant="outline">auto on</Badge>}
                  </div>
                  {rec?.last_run_summary && (
                    <div className="flex items-start gap-1.5 mt-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                      <span className="break-words">{rec.last_run_summary}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Auto</span>
                    <Switch checked={enabled} onCheckedChange={(on) => toggle(c, on)} />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={busyId === c.id}
                    onClick={() => runNow(c)}
                  >
                    {busyId === c.id ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    Run now
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}