import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

export default function AccountPicker({ accounts, selected, onSelect }) {
  return (
    <div className="space-y-1.5 max-w-md">
      <Label>Ad account</Label>
      <Select value={selected || undefined} onValueChange={onSelect}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select an ad account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.account_id} value={a.account_id}>
              {a.name} ({a.account_id}){a.currency ? ` · ${a.currency}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}