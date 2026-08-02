import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Contact, RefreshCw, Loader2, Search, MessageSquare, ArrowUp, ArrowDown, MessageCircle, ImageIcon } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import CustomerDetailDialog from '@/components/CustomerDetailDialog';
import CustomerSmsDialog from '@/components/CustomerSmsDialog';
import BulkMessageDialog from '@/components/BulkMessageDialog';

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function Th({ field, sortField, sortDir, onSort, className = '', children }) {
  const active = sortField === field;
  return (
    <th className={`p-2 font-medium cursor-pointer select-none ${className}`} onClick={() => onSort(field)}>
      <span className={`inline-flex items-center gap-1 ${className.includes('text-right') ? 'justify-end w-full' : ''}`}>
        {children}
        {active && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );
}

export default function Customers() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [smsTarget, setSmsTarget] = useState(null);
  const [sortField, setSortField] = useState('total_spent');
  const [sortDir, setSortDir] = useState('desc');
  const [amountOp, setAmountOp] = useState('any');
  const [amountVal, setAmountVal] = useState('');
  const [lastOrderOp, setLastOrderOp] = useState('any');
  const [lastOrderMonths, setLastOrderMonths] = useState('3');
  const [storeFilter, setStoreFilter] = useState('any');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMode, setBulkMode] = useState(null);

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

  const MONTHS_MS = 30 * 24 * 60 * 60 * 1000;

  const filtered = customers
    .filter((c) => {
      const q = query.trim().toLowerCase();
      if (q && ![c.name, c.email, c.phone, c.last_store].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      if (storeFilter !== 'any') {
        const stores = (c.stores || []).map((s) => String(s || '').toLowerCase());
        if (!stores.includes(storeFilter.toLowerCase())) return false;
      }
      if (amountOp !== 'any' && amountVal !== '') {
        const amt = Number(c.total_spent) || 0;
        const threshold = Number(amountVal);
        if (amountOp === 'gt' && !(amt > threshold)) return false;
        if (amountOp === 'lt' && !(amt < threshold)) return false;
      }
      if (lastOrderOp !== 'any') {
        const lastTs = c.last_order_date ? new Date(c.last_order_date).getTime() : 0;
        const monthsAgo = Date.now() - Number(lastOrderMonths || 0) * MONTHS_MS;
        if (lastOrderOp === 'within' && !(lastTs >= monthsAgo)) return false;
        if (lastOrderOp === 'older' && !(lastTs < monthsAgo)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'name') return (String(a.name || '').localeCompare(String(b.name || ''))) * dir;
      if (sortField === 'last_order') {
        return ((new Date(a.last_order_date || 0).getTime()) - (new Date(b.last_order_date || 0).getTime())) * dir;
      }
      return ((Number(a.total_spent) || 0) - (Number(b.total_spent) || 0)) * dir;
    });

  const totalRevenue = customers.reduce((s, c) => s + (Number(c.total_spent) || 0), 0);
  const totalOrders = customers.reduce((s, c) => s + (Number(c.total_orders) || 0), 0);
  const storeOptions = React.useMemo(
    () => Array.from(new Set(customers.flatMap((c) => c.stores || []).map((s) => String(s || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [customers]
  );

  const toggleSort = (f) => {
    if (sortField === f) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir(f === 'name' ? 'asc' : 'desc'); }
  };

  const toggle = (id) => setSelectedIds((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(filtered.map((c) => c.id)));
  const bulkRecipients = customers.filter((c) => selectedIds.has(c.id));

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
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between">
            <CardTitle>Customer list <span className="text-sm font-normal text-muted-foreground">({filtered.length} shown)</span></CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone…" className="pl-8" />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Sort by</p>
              <Select value={sortField} onValueChange={setSortField}>
                <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name (A–Z)</SelectItem>
                  <SelectItem value="last_order">Last order date</SelectItem>
                  <SelectItem value="total_spent">Total spent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}>
              {sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {sortDir === 'asc' ? 'Ascending' : 'Descending'}
            </Button>
            <div className="flex items-end gap-1.5">
              <Select value={storeFilter} onValueChange={setStoreFilter}>
                <SelectTrigger className="w-48 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All stores</SelectItem>
                  {storeOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-1.5">
              <Select value={amountOp} onValueChange={setAmountOp}>
                <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any amount</SelectItem>
                  <SelectItem value="gt">Greater than</SelectItem>
                  <SelectItem value="lt">Less than</SelectItem>
                </SelectContent>
              </Select>
              {amountOp !== 'any' && (
                <Input type="number" min="0" value={amountVal} onChange={(e) => setAmountVal(e.target.value)} placeholder="$ amount" className="w-24 h-8" />
              )}
            </div>
            <div className="flex items-end gap-1.5">
              <Select value={lastOrderOp} onValueChange={setLastOrderOp}>
                <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any last order</SelectItem>
                  <SelectItem value="within">Ordered within</SelectItem>
                  <SelectItem value="older">No order in last</SelectItem>
                </SelectContent>
              </Select>
              {lastOrderOp !== 'any' && (
                <div className="flex items-center gap-1">
                  <Input type="number" min="1" value={lastOrderMonths} onChange={(e) => setLastOrderMonths(e.target.value)} className="w-16 h-8" />
                  <span className="text-xs text-muted-foreground">mo</span>
                </div>
              )}
            </div>
            {(amountOp !== 'any' || lastOrderOp !== 'any' || query || storeFilter !== 'any') && (
              <Button size="sm" variant="ghost" onClick={() => { setAmountOp('any'); setAmountVal(''); setLastOrderOp('any'); setQuery(''); setStoreFilter('any'); }}>Clear filters</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-md bg-muted/60 border">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Button size="sm" variant="outline" onClick={() => setBulkMode('sms')}>
                <MessageCircle className="h-3.5 w-3.5" /> SMS to all
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkMode('mms')}>
                <ImageIcon className="h-3.5 w-3.5" /> MMS to all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear selection</Button>
            </div>
          )}
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
                    <th className="p-2 w-8">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </th>
                    <Th field="name" sortField={sortField} sortDir={sortDir} onSort={(f) => toggleSort(f)}>Customer</Th>
                    <th className="text-left p-2 font-medium">Contact</th>
                    <th className="text-right p-2 font-medium">Orders</th>
                    <Th field="total_spent" sortField={sortField} sortDir={sortDir} onSort={(f) => toggleSort(f)} className="text-right">Total spent</Th>
                    <th className="text-right p-2 font-medium">Avg order</th>
                    <th className="text-left p-2 font-medium">Last store</th>
                    <Th field="last_order" sortField={sortField} sortDir={sortDir} onSort={(f) => toggleSort(f)}>Last order</Th>
                    <th className="w-16 p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => setSelected(c)}>
                      <td className="p-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggle(c.id)} aria-label="Select" />
                      </td>
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
      <CustomerSmsDialog customer={smsTarget} onClose={() => setSmsTarget(null)} onSent={() => setSelected(null)} />
      <BulkMessageDialog recipients={bulkMode ? bulkRecipients : null} mode={bulkMode} onClose={() => setBulkMode(null)} onSent={() => setSelectedIds(new Set())} />
    </div>
  );
}