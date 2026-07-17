import React, { useState } from 'react';
import { TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Play,
  Pause,
  Save,
  Loader2,
  MoreVertical,
  Pencil,
  Copy,
  Trash2,
  Images,
} from 'lucide-react';
import AddVariantsDialog from '@/components/AddVariantsDialog';

export default function CampaignRow({
  campaign,
  accountId,
  busy,
  onToggle,
  onBudget,
  onEdit,
  onCopy,
  onDelete,
}) {
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState(
    campaign.daily_budget ? (Number(campaign.daily_budget) / 100).toFixed(2) : ''
  );
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(campaign.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const ins = campaign.insights || {};

  const saveBudget = async () => {
    const dollars = parseFloat(budget);
    if (isNaN(dollars)) return;
    await onBudget(campaign, dollars);
    setEditing(false);
  };

  const submitEdit = async () => {
    if (!editName.trim()) return;
    await onEdit(campaign, editName.trim());
    setEditOpen(false);
  };

  return (
    <TableRow>
      <TableCell className="font-medium max-w-xs truncate">{campaign.name}</TableCell>
      <TableCell>
        <Badge variant={campaign.status === 'ACTIVE' ? 'default' : 'secondary'}>
          {campaign.status}
        </Badge>
      </TableCell>
      <TableCell className="capitalize text-muted-foreground">
        {campaign.objective || '—'}
      </TableCell>
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
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={campaign.status === 'ACTIVE' ? 'outline' : 'default'}
            onClick={() => onToggle(campaign)}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" disabled={busy}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setEditName(campaign.name);
                  setEditOpen(true);
                }}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopy(campaign)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setVariantsOpen(true)}>
                <Images className="h-4 w-4 mr-2" />
                Add image variants
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <label className="text-sm font-medium">Campaign name</label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete campaign?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This permanently deletes “{campaign.name}” and all its ad sets and ads.
            This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setDeleteOpen(false);
                onDelete(campaign);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddVariantsDialog
        accountId={accountId}
        campaign={campaign}
        open={variantsOpen}
        onOpenChange={setVariantsOpen}
      />
    </TableRow>
  );
}