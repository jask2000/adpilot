import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Loader2, Wallet } from 'lucide-react';

export default function AccountInfo({ account }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!account?.account_id) return;
    let alive = true;
    setLoading(true);
    setError(null);
    base44.functions
      .invoke('metaAds', { action: 'get_spend', account_id: account.account_id })
      .then((res) => {
        if (alive) setData(res.data);
      })
      .catch((e) => {
        if (alive) setError(e.message || 'Failed to load account details');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [account?.account_id]);

  const currency = data?.currency || account?.currency || 'USD';
  const fmt = (v) =>
    `${currency} ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" /> Account details
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading account info…
          </p>
        ) : error ? (
          <p className="text-sm text-destructive break-all">{error}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-muted-foreground text-xs">Account name</p>
              <p className="font-medium truncate">{account?.name || '—'}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-muted-foreground text-xs">Account ID</p>
              <p className="font-mono text-xs break-all">{account?.account_id || '—'}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-muted-foreground text-xs">Currency</p>
              <p className="font-medium">{currency}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-muted-foreground text-xs">Amount spent</p>
              <p className="font-medium">{fmt((data?.amount_spent || 0) / 100)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-muted-foreground text-xs">Spend cap</p>
              <p className="font-medium">
                {data?.spend_cap > 0 ? fmt(data.spend_cap / 100) : 'No cap'}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-muted-foreground text-xs">Balance</p>
              <p className="font-medium">{fmt((data?.balance || 0) / 100)}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}