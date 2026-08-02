import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, RefreshCw, TrendingUp, Store, Loader2 } from 'lucide-react';

export default function Purchases() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);

  const loadOrders = useCallback(async () => {
    try {
      const res = await base44.entities.ProcessedOrder.list('-sent_at', 200);
      setOrders(res || []);
    } catch (e) {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const handleRun = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await base44.functions.invoke('sendOrderConversions', {});
      setRunResult(res.data);
      await loadOrders();
    } catch (e) {
      setRunResult({ error: e.message });
    } finally {
      setRunning(false);
    }
  };

  const sentOrders = orders.filter(o => o.status === 'sent');
  const totalRevenue = sentOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const byStore = {};
  for (const o of sentOrders) {
    const key = o.store_name || 'Unknown';
    byStore[key] = (byStore[key] || { count: 0, revenue: 0 });
    byStore[key].count += 1;
    byStore[key].revenue += Number(o.amount) || 0;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6" /> Purchase Tracking
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Online orders from your inbox, sent to Meta as Purchase events for ad attribution.
          </p>
        </div>
        <Button onClick={handleRun} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync inbox now
        </Button>
      </div>

      {runResult && (
        <div className="text-sm rounded-lg border bg-muted/40 px-4 py-3">
          {runResult.error ? (
            <span className="text-destructive">Error: {runResult.error}</span>
          ) : (
            <span>
              Scanned {runResult.scanned} · Sent {runResult.sent} · Skipped {runResult.skipped} · Errors {runResult.errors}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2"><TrendingUp className="h-5 w-5 text-muted-foreground" /><CardTitle className="text-base">Purchases sent to Meta</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-semibold">{sentOrders.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2"><ShoppingCart className="h-5 w-5 text-muted-foreground" /><CardTitle className="text-base">Tracked revenue</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-semibold">${totalRevenue.toFixed(2)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2"><Store className="h-5 w-5 text-muted-foreground" /><CardTitle className="text-base">Stores reporting</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-semibold">{Object.keys(byStore).length}</p></CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-heading font-semibold">By store</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(byStore).map(([store, v]) => (
            <Card key={store}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium text-sm">{store}</p>
                  <p className="text-xs text-muted-foreground">{v.count} purchases</p>
                </div>
                <p className="text-lg font-semibold">${v.revenue.toFixed(2)}</p>
              </CardContent>
            </Card>
          ))}
          {sentOrders.length === 0 && <p className="text-sm text-muted-foreground">No purchases sent yet.</p>}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-heading font-semibold">Recent orders</h2>
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/40">
            <span>Order #</span><span>Customer</span><span>Amount</span><span>Status</span>
          </div>
          {orders.map(o => (
            <div key={o.id} className="grid grid-cols-[auto_1fr_auto_auto] gap-3 px-4 py-2 text-sm border-t items-center">
              <span className="font-mono text-xs">{o.order_number}</span>
              <span className="truncate text-muted-foreground">{o.customer_name || o.customer_email || '—'}</span>
              <span className="tabular-nums">${(Number(o.amount) || 0).toFixed(2)}</span>
              <Badge variant={o.status === 'sent' ? 'default' : 'destructive'}>{o.status === 'sent' ? 'Sent' : 'Error'}</Badge>
            </div>
          ))}
          {orders.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No orders yet.</p>}
        </div>
      </div>
    </div>
  );
}