import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Contact, RefreshCw, Loader2, Search, MessageSquare } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import CustomerDetailDialog from '@/components/CustomerDetailDialog';
import CustomerSmsDialog from '@/components/CustomerSmsDialog';

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function Customers() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [smsTarget, setSmsTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const records = await base44.entities.Customer.list('-total_spent', 500);
      setCustomers(records || []);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to load', description: e.response?.data?.error || e.message });
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await base44.functions.invoke('syncCustomers', {});
      toast({ title: 'Customers synced', description: `${res.data.customers} customers · ${res.data.orders_processed} orders · ${money(res.data.total_revenue)} revenue` });
      await load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Sync failed', description: e.response?.data?.error || e.message });
    } finally {
      setSyncing(false);
    }
  };

  const filtered = customers.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.email, c.phone, c.last_store].some((v) => String(v || '').toLowerCase().includes(q));
  });

  const totalRevenue = customers.reduce((s, c) => s + (Number(c.total_spent) || 0), 0);
  const totalOrders = customers.reduce((s, c) => s + (Number(c.total_orders) || 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
          <Contact className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-heading font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">Aggregated customer profiles built from your order data.</p>
        </div>
        <Button onClick={sync} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync from orders
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Customers</p>
            <p className="text-2xl font-semibold">{customers.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Total orders</p>
            <p className="text-2xl font-semibold">{totalOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Lifetime revenue</p>
            <p className="text-2xl font-semibold">{money(totalRevenue)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Customer list</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone…" className="pl-8" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : customers.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <p className="text-sm text-muted-foreground">No customers yet. Sync from your order data to populate.</p>
              <Button onClick={sync} disabled={syncing}>Sync now</Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No matches.</p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium">Customer</th>
                    <th className="text-left p-2 font-medium">Contact</th>
                    <th className="text-right p-2 font-medium">Orders</th>
                    <th className="text-right p-2 font-medium">Total spent</th>
                    <th className="text-right p-2 font-medium">Avg order</th>
                    <th className="text-left p-2 font-medium">Last store</th>
                    <th className="text-left p-2 font-medium">Last order</th>
                    <th className="w-16 p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => setSelected(c)}>
                      <td className="p-2 font-medium">{c.name || '—'}</td>
                      <td className="p-2 text-xs">
                        <div>{c.email || '—'}</div>
                        <div className="text-muted-foreground">{c.phone || '—'}</div>
                      </td>
                      <td className="p-2 text-right">{c.total_orders || 0}</td>
                      <td className="p-2 text-right font-medium">{money(c.total_spent)}</td>
                      <td className="p-2 text-right text-muted-foreground">{money(c.avg_order_value)}</td>
                      <td className="p-2">{c.last_store || '—'}</td>
                      <td className="p-2 text-xs text-muted-foreground">{c.last_order_date ? new Date(c.last_order_date).toLocaleDateString() : '—'}</td>
                      <td className="p-2">
                        <Button size="sm" variant="outline" disabled={!c.phone}
                          onClick={(e) => { e.stopPropagation(); setSmsTarget(c); }}>
                          <MessageSquare className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CustomerDetailDialog customer={selected} onClose={() => setSelected(null)} />
      <CustomerSmsDialog customer={smsTarget} onClose={() => setSmsTarget(null)} />
    </div>
  );
}