import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Send, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function BulkMessageDialog({ recipients, mode, onClose }) {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [sending, setSending] = useState(false);

  const open = !!recipients;
  const withPhone = (recipients || []).filter((r) => r.phone);
  const withoutPhone = (recipients || []).length - withPhone.length;
  const isMms = mode === 'mms';

  const send = async () => {
    if (!withPhone.length || !message.trim()) return;
    setSending(true);
    try {
      const payload = {
        action: 'send',
        recipients: withPhone.map((r) => ({
          order_number: `CUST-${r.id}`,
          customer_name: r.name,
          customer_phone: r.phone,
          store_name: r.last_store || ''
        })),
        message,
        date: new Date().toISOString().slice(0, 10)
      };
      if (isMms && mediaUrl.trim()) payload.media_url = mediaUrl.trim();
      const res = await base44.functions.invoke('sendOrderSMS', payload);
      const { sent, failed } = res.data;
      toast({
        title: `Sent to ${sent || 0} of ${withPhone.length}`,
        description: failed ? `${failed} failed` : (withoutPhone ? `${withoutPhone} without phone skipped` : 'All delivered'),
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isMms ? 'MMS' : 'SMS'} to {withPhone.length} customer{withPhone.length === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            {withoutPhone > 0 ? `${withoutPhone} selected customer(s) without a phone number will be skipped. ` : ''}
            Each message is sent individually.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isMms && (
            <div className="space-y-1.5">
              <Label className="text-xs">Media URL (publicly accessible image)</Label>
              <Input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://…/promo.jpg" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Message</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} placeholder="Type your message…" />
            {message.length > 160 && (
              <p className="text-xs text-amber-600">Over 160 characters — will be split into multiple SMS segments.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || !message.trim() || !withPhone.length}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send to {withPhone.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}