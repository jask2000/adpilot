import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { MessageSquare, Send, Loader2, RefreshCw, Inbox } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const DEFAULT_MSG = 'Thanks for your order at HELLCRUST PIZZA! We hope you enjoyed it. See you again soon — order at hellcrustpizza.com';

export default function CustomerSms() {
  const { toast } = useToast();
  const [date, setDate] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MSG);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [replies, setReplies] = useState([]);
  const [loadingReplies, setLoadingReplies] = useState(false);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('sendOrderSMS', { action: 'preview', date });
      setCustomers(res.data.customers || []);
      setSelected(new Set());
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to load', description: e.response?.data?.error || e.message });
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await base44.functions.invoke('sendOrderSMS', { action: 'history', limit: 50 });
      setHistory(res.data.history || []);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to load history', description: e.response?.data?.error || e.message });
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadReplies = async () => {
    setLoadingReplies(true);
    try {
      const records = await base44.entities.SmsReply.list('-received_at', 50);
      setReplies(records || []);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to load replies', description: e.response?.data?.error || e.message });
    } finally {
      setLoadingReplies(false);
    }
  };

  React.useEffect(() => { loadHistory(); loadReplies(); }, []);

  const toggle = (orderNumber) => {
    const next = new Set(selected);
    if (next.has(orderNumber)) next.delete(orderNumber); else next.add(orderNumber);
    setSelected(next);
  };

  const toggleAll = () => {
    const eligible = customers.filter((c) => !c.already_sent);
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible.map((c) => c.order_number)));
  };

  const openCompose = () => {
    if (!selected.size) { toast({ title: 'Select at least one customer' }); return; }
    setModalOpen(true);
  };

  const confirmSend = async () => {
    setSending(true);
    const recipients = customers.filter((c) => selected.has(c.order_number));
    try {
      const res = await base44.functions.invoke('sendOrderSMS', { action: 'send', recipients, message, date });
      const { sent, failed } = res.data;
      toast({ title: 'SMS sent', description: `${sent} sent${failed ? `, ${failed} failed` : ''}` });
      setModalOpen(false);
      await loadCustomers();
      await loadHistory();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Send failed', description: e.response?.data?.error || e.message });
    } finally {
      setSending(false);
    }
  };

  const eligibleCount = customers.filter((c) => !c.already_sent).length;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-semibold">Customer SMS</h1>
          <p className="text-sm text-muted-foreground">Text yesterday's customers a thank-you via your Twilio number.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pick a day &amp; load customers</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="date">Order date</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
          <Button onClick={loadCustomers} disabled={loading || !date}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Load customers
          </Button>
        </CardContent>
      </Card>

      {customers.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{customers.length} customer(s) · {eligibleCount} eligible</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={toggleAll} disabled={!eligibleCount}>
                {selected.size === eligibleCount && eligibleCount > 0 ? 'Clear' : 'Select all'}
              </Button>
              <Button size="sm" onClick={openCompose} disabled={!selected.size}>
                <Send className="h-4 w-4" /> Compose &amp; Send ({selected.size})
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="w-10 p-2"></th>
                    <th className="text-left p-2 font-medium">Order</th>
                    <th className="text-left p-2 font-medium">Customer</th>
                    <th className="text-left p-2 font-medium">Phone</th>
                    <th className="text-left p-2 font-medium">Store</th>
                    <th className="text-left p-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.order_number} className="border-t">
                      <td className="p-2">
                        <Checkbox
                          checked={selected.has(c.order_number)}
                          onCheckedChange={() => toggle(c.order_number)}
                          disabled={c.already_sent}
                        />
                      </td>
                      <td className="p-2 font-mono text-xs">{c.order_number}</td>
                      <td className="p-2">{c.customer_name || '—'}</td>
                      <td className="p-2">{c.customer_phone}</td>
                      <td className="p-2">{c.store_name || '—'}</td>
                      <td className="p-2">
                        {c.already_sent ? <Badge variant="secondary">Already texted</Badge> : <Badge>New</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Recent SMS history</CardTitle>
          <Button variant="ghost" size="sm" onClick={loadHistory} disabled={loadingHistory}>
            {loadingHistory ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No SMS sent yet.</p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium">Sent</th>
                    <th className="text-left p-2 font-medium">Customer</th>
                    <th className="text-left p-2 font-medium">Phone</th>
                    <th className="text-left p-2 font-medium">Message</th>
                    <th className="text-left p-2 font-medium">Status</th>
                    <th className="text-left p-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t">
                      <td className="p-2 text-xs text-muted-foreground">{h.sent_at ? new Date(h.sent_at).toLocaleString() : '—'}</td>
                      <td className="p-2">{h.customer_name || '—'}</td>
                      <td className="p-2 text-xs">{h.customer_phone}</td>
                      <td className="p-2 max-w-xs truncate text-muted-foreground">{h.message}</td>
                      <td className="p-2">{h.status === 'sent' ? <Badge>sent</Badge> : <Badge variant="destructive">failed</Badge>}</td>
                      <td className="p-2"><Badge variant="outline">{h.source}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2"><Inbox className="h-4 w-4" /> Customer replies</CardTitle>
          <Button variant="ghost" size="sm" onClick={loadReplies} disabled={loadingReplies}>
            {loadingReplies ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {replies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No replies yet. Once you set the webhook URL in Twilio, inbound messages will appear here.</p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium">Received</th>
                    <th className="text-left p-2 font-medium">From</th>
                    <th className="text-left p-2 font-medium">Customer</th>
                    <th className="text-left p-2 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {replies.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2 text-xs text-muted-foreground">{r.received_at ? new Date(r.received_at).toLocaleString() : '—'}</td>
                      <td className="p-2 text-xs">{r.from_phone}</td>
                      <td className="p-2">{r.customer_name || '—'}</td>
                      <td className="p-2 max-w-xs">{r.body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Compose SMS</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Recipients: {selected.size}</span>
              <span>{message.length} chars</span>
            </div>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} />
            {message.length > 160 && (
              <p className="text-xs text-amber-600">Over 160 characters — will be split into multiple SMS segments by Twilio.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={confirmSend} disabled={sending || !message.trim()}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send {selected.size} SMS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}