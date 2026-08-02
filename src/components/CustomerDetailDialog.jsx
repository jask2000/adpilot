import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Match the same normalization used by syncCustomers so grouping == lookup.
const normEmail = (e) => (e ? String(e).trim().toLowerCase() : '');
const normPhone = (p) => {
  if (!p) return '';
  let d = String(p).replace(/\D/g, '');
  if (d.length === 10) d = '1' + d;
  if (d.length === 11 && d.startsWith('1')) return d;
  if (d.length > 11) return d;
  return d;
};
const last10 = (p) => {
  const d = normPhone(p);
  return d.length >= 10 ? d.slice(-10) : d;
};

export default function CustomerDetailDialog({ customer, onClose }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customer) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const all = await base44.entities.ProcessedOrder.list('-order_date', 5000);
        const eKey = normEmail(customer.email);
        const pKey = last10(customer.phone);
        const matched = (all || []).filter((o) => {
          if (eKey && normEmail(o.customer_email) === eKey) return true;
          if (pKey && last10(o.customer_phone) === pKey) return true;
          return false;
        });
        matched.sort((a, b) => new Date(b.order_date || 0).getTime() - new Date(a.order_date || 0).getTime());
        if (active) setOrders(matched);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [customer]);

  if (!customer) return null;

  return (
    <Dialog open={!!customer} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{customer.name || 'Customer'}</DialogTitle>
          <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {customer.email && <span>{customer.email}</span>}
            {customer.phone && <span>{customer.phone}</span>}
            {customer.last_store && <span>· {customer.last_store}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-3 py-2">
          <Stat label="Orders" value={customer.total_orders || 0} />
          <Stat label="Total spent" value={money(customer.total_spent)} />
          <Stat label="Avg order" value={money(customer.avg_order_value)} />
          <Stat label="First order" value={customer.first_order_date ? new Date(customer.first_order_date).toLocaleDateString() : '—'} />
        </div>

        {(customer.stores?.length > 0 || customer.order_types?.length > 0) && (
          <div className="flex flex-wrap gap-2 pb-2">
            {customer.stores?.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
            {customer.order_types?.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
          </div>
        )}

        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium">Order #</th>
                <th className="text-left p-2 font-medium">Date</th>
                <th className="text-right p-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" /></td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">No order history found.</td></tr>
              ) : orders.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="p-2 font-mono text-xs">{o.order_number}</td>
                  <td className="p-2 text-xs text-muted-foreground">{o.order_date ? new Date(o.order_date).toLocaleString() : '—'}</td>
                  <td className="p-2 text-right font-medium">{money(o.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}