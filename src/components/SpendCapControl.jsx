import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ShieldCheck } from 'lucide-react';

export default function SpendCapControl({ accountId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('metaAds', {
        action: 'get_spend',
        account_id: accountId,
      });
      setData(res.data);
      setCap(res.data.spend_cap ? (res.data.spend_cap / 100).toFixed(2) : '');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accountId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const dollars = parseFloat(cap) || 0;
      await base44.functions.invoke('metaAds', {
        action: 'set_spend_cap',
        account_id: accountId,
        cap: dollars,
      });
      await load();
      setMsg(
        dollars > 0
          ? 'Spend cap set. Meta will pause delivery once the cap is reached.'
          : 'Spend cap removed.'
      );
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const pct =
    data && data.spend_cap > 0
      ? Math.min(100, (data.amount_spent / data.spend_cap) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Spend cap
        </CardTitle>
        <CardDescription>
          Meta pauses all delivery once lifetime spend reaches this amount. Set
          0 to remove the cap.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                Spent: {data?.currency} {(data?.amount_spent / 100).toFixed(2)}
              </span>
              <span className="text-muted-foreground">
                {data?.spend_cap > 0
                  ? `Cap: ${data.currency} ${(data.spend_cap / 100).toFixed(2)}`
                  : 'No cap set'}
              </span>
            </div>
            {data?.spend_cap > 0 && (
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
            )}
            <form onSubmit={save} className="flex items-end gap-2">
              <div className="space-y-1.5 flex-1 max-w-[200px]">
                <Label>Cap amount ({data?.currency || 'USD'})</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Set cap'
                )}
              </Button>
            </form>
            {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}