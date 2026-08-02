import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function CustomerSmsDialog({ customer, onClose }) {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const open = () => {
    setMessage(`Hi${customer?.name ? ` ${customer.name}` : ''}, `);
  };

  React.useEffect(() => { if (customer) open(); }, [customer]);

  if (!customer) return null;

  const send = async () => {
    if (!customer.phone || !message.trim()) return;
    setSending(true);
    try {
      const res = await base44.functions.invoke('sendOrderSMS', {
        action: 'send',
        recipients: [{
          order_number: `CUST-${customer.id}`,
          customer_name: customer.name,
          customer_phone: customer.phone,
          store_name: customer.last_store || ''
        }],
        message,
        date: new Date().toISOString().slice(0, 10)
      });
      const { sent, failed } = res.data;
      toast({
        title: sent ? 'Message sent' : 'Send failed',
        description: failed ? `${failed} failed` : 'Delivered to ' + customer.phone,
        variant: sent ? 'default' : 'destructive'
      });
      if (sent) onClose();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Send failed', description: e.response?.data?.error || e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!customer} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Message {customer.name || 'customer'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">To: {customer.phone}</p>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} placeholder="Type your message…" />
          {message.length > 160 && (
            <p className="text-xs text-amber-600">Over 160 characters — will be split into multiple SMS segments.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || !message.trim() || !customer.phone}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}