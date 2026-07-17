import React, { useState } from 'react';
import { TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Save, Loader2 } from 'lucide-react';

export default function CampaignRow({ campaign, busy, onToggle, onBudget }) {
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState(
    campaign.daily_budget ? (Number(campaign.daily_budget) / 100).toFixed(2) : ''
  );
  const ins = campaign.insights || {};

  const saveBudget = async () => {
    const dollars = parseFloat(budget);
    if (isNaN(dollars)) return;
    await onBudget(campaign, dollars);
    setEditing(false);
  };

  return (
    <TableRow>
      <TableCell className="font-medium max-w-xs truncate">{campaign.name}</TableCell>
      <TableCell>
        <Badge variant={campaign.status === 'ACTIVE' ? 'default' : 'secondary'}>
          {campaign.status}
        </Badge>
      </TableCell>
      <TableCell className="capitalize text-muted-foreground">{campaign.objective || '—'}</TableCell>
      <TableCell>${ins.spend ? parseFloat(ins.spend).toFixed(2) : '0.00'}</TableCell>
      <TableCell>{ins.clicks || 0}</TableCell>
      <TableCell>{ins.ctr ? parseFloat(ins.ctr).toFixed(2) + '%' : '0%'}</TableCell>
      <TableCell>
        {editing ? (
          <div className="flex gap-1">
            <Input
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-24 h-8"
              type="number"
              step="0.01"
            />
            <Button size="icon" className="h-8 w-8" onClick={saveBudget} disabled={busy}>
              <Save className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-sm hover:underline text-primary"
          >
            {campaign.daily_budget ? '$' + (Number(campaign.daily_budget) / 100).toFixed(2) : '—'}
          </button>
        )}
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          variant={campaign.status === 'ACTIVE' ? 'outline' : 'default'}
          onClick={() => onToggle(campaign)}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : campaign.status === 'ACTIVE' ? (
            <>
              <Pause className="h-4 w-4 mr-1" />
              Pause
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-1" />
              Resume
            </>
          )}
        </Button>
      </TableCell>
    </TableRow>
  );
}