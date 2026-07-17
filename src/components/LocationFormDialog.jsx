import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

const empty = { name: '', address: '', city: '', province: 'BC', country: 'Canada', postal_code: '' };

export default function LocationFormDialog({ open, initial, mode, onClose, onSave }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(initial ? { ...empty, ...initial } : empty);
    setError('');
  }, [open, initial]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.city || !form.province) {
      setError('Name, city, and province are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save location.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit Location' : 'Add Location'}</DialogTitle>
          <DialogDescription>
            {mode === 'edit' ? 'Update this store\'s details.' : 'Add a new store location to target with ads.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="loc-name">Name *</Label>
            <Input id="loc-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Davie St" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="loc-address">Address</Label>
            <Input id="loc-address" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street address" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="loc-city">City *</Label>
              <Input id="loc-city" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="loc-province">Province *</Label>
              <Input id="loc-province" value={form.province} onChange={(e) => set('province', e.target.value)} placeholder="BC" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="loc-country">Country</Label>
              <Input id="loc-country" value={form.country} onChange={(e) => set('country', e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="loc-postal">Postal code</Label>
              <Input id="loc-postal" value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {mode === 'edit' ? 'Save changes' : 'Add location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}