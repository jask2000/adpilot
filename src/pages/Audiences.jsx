import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Loader2, Users, Plus, Pencil } from 'lucide-react';

export default function Audiences() {
  const [accounts, setAccounts] = useState(null);
  const [account, setAccount] = useState(null);
  const [audiences, setAudiences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [ca, setCa] = useState({ name: '', description: '' });
  const [lk, setLk] = useState({ origin: '', country: 'CA', ratio: '0.01' });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', countries: '', ageMin: '', ageMax: '', gender: 'all' });

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke('metaAds', {
          action: 'list_accounts',
        });
        const accs = res.data.accounts || [];
        setAccounts(accs);
        const cfgs = await base44.entities.AppConfig.list();
        const saved = cfgs[0]?.selected_ad_account_id;
        const acc =
          accs.find((a) => String(a.account_id) === String(saved)) ||
          accs[0] ||
          null;
        setAccount(acc);
        if (acc) await loadAudiences(acc);
      } catch (e) {
        setMsg(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadAudiences = async (acc) => {
    try {
      const res = await base44.functions.invoke('metaAds', {
        action: 'list_audiences',
        account_id: acc.account_id || acc.id,
      });
      setAudiences(res.data.audiences || []);
    } catch (e) {
      setMsg(e.message);
    }
  };

  const createCustom = async (e) => {
    e.preventDefault();
    if (!account || !ca.name) return;
    setBusy(true);
    setMsg(null);
    try {
      await base44.functions.invoke('metaAds', {
        action: 'create_audience',
        account_id: account.account_id || account.id,
        name: ca.name,
        description: ca.description,
      });
      setCa({ name: '', description: '' });
      await loadAudiences(account);
      setMsg('Custom audience created.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const createLookalike = async (e) => {
    e.preventDefault();
    if (!account || !lk.origin) return;
    setBusy(true);
    setMsg(null);
    try {
      await base44.functions.invoke('metaAds', {
        action: 'create_lookalike',
        account_id: account.account_id || account.id,
        origin_audience_id: lk.origin,
        country: lk.country,
        ratio: parseFloat(lk.ratio),
      });
      setLk({ ...lk, origin: '' });
      await loadAudiences(account);
      setMsg('Lookalike audience created.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (a) => {
    setEditing(a);
    const t = a.targeting || {};
    const genders = t.genders || [];
    const gender = (genders.length === 0 || genders.length === 2) ? 'all' : (genders[0] === 1 ? 'male' : 'female');
    setEditForm({
      name: a.name || '',
      description: a.description || '',
      countries: ((t.geo_locations && t.geo_locations.countries) || []).join(', '),
      ageMin: t.age_min != null ? String(t.age_min) : '',
      ageMax: t.age_max != null ? String(t.age_max) : '',
      gender,
    });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editing || !editForm.name) return;
    setBusy(true);
    setMsg(null);
    try {
      const payload = {
        action: 'update_audience',
        audience_id: editing.id,
        name: editForm.name,
        description: editForm.description,
      };
      if (editing.kind === 'saved') {
        const t = { ...(editing.targeting || {}) };
        if (editForm.countries.trim()) {
          t.geo_locations = { ...(t.geo_locations || {}), countries: editForm.countries.split(',').map((s) => s.trim()).filter(Boolean) };
        }
        if (editForm.ageMin) t.age_min = parseInt(editForm.ageMin, 10);
        else delete t.age_min;
        if (editForm.ageMax) t.age_max = parseInt(editForm.ageMax, 10);
        else delete t.age_max;
        t.genders = editForm.gender === 'all' ? [] : [editForm.gender === 'male' ? 1 : 2];
        payload.targeting = t;
      }
      await base44.functions.invoke('metaAds', payload);
      setEditing(null);
      await loadAudiences(account);
      setMsg('Audience updated.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" /> Audiences
        </h1>
        <p className="text-muted-foreground text-sm">
          Create, edit, and reuse custom &amp; lookalike audiences for targeting.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New custom audience</CardTitle>
            <CardDescription>An empty audience you can populate later.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createCustom} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  required
                  value={ca.name}
                  onChange={(e) => setCa({ ...ca, name: e.target.value })}
                  placeholder="Website visitors"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={ca.description}
                  onChange={(e) => setCa({ ...ca, description: e.target.value })}
                  rows={2}
                />
              </div>
              <Button type="submit" disabled={busy}>
                <Plus className="h-4 w-4 mr-2" />
                Create
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">New lookalike audience</CardTitle>
            <CardDescription>Based on an existing audience.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createLookalike} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Source audience</Label>
                <Select value={lk.origin} onValueChange={(v) => setLk({ ...lk, origin: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {audiences.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Country</Label>
                  <Input
                    value={lk.country}
                    onChange={(e) => setLk({ ...lk, country: e.target.value })}
                    placeholder="CA"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Ratio (0-1)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="0.2"
                    value={lk.ratio}
                    onChange={(e) => setLk({ ...lk, ratio: e.target.value })}
                  />
                </div>
              </div>
              <Button type="submit" disabled={busy || !lk.origin}>
                <Plus className="h-4 w-4 mr-2" />
                Create lookalike
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Existing audiences</CardTitle>
        </CardHeader>
        <CardContent>
          {audiences.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No audiences yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audiences.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">{a.subtype}</TableCell>
                    <TableCell>{a.approximate_count || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.status || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(a)}
                        disabled={busy}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit audience</DialogTitle>
            <DialogDescription>
              Update the name and description for this {editing?.subtype} audience.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                required
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={2}
              />
            </div>
            {editing?.kind === 'saved' && (
              <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Targeting</p>
                <div className="space-y-1.5">
                  <Label>Countries (comma-separated codes)</Label>
                  <Input
                    value={editForm.countries}
                    onChange={(e) => setEditForm({ ...editForm, countries: e.target.value })}
                    placeholder="CA, US"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Min age</Label>
                    <Input
                      type="number"
                      min="13"
                      max="65"
                      value={editForm.ageMin}
                      onChange={(e) => setEditForm({ ...editForm, ageMin: e.target.value })}
                      placeholder="18"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max age</Label>
                    <Input
                      type="number"
                      min="13"
                      max="65"
                      value={editForm.ageMax}
                      onChange={(e) => setEditForm({ ...editForm, ageMax: e.target.value })}
                      placeholder="65"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Gender</Label>
                  <Select value={editForm.gender} onValueChange={(v) => setEditForm({ ...editForm, gender: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {busy && !editing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Working…
        </div>
      )}
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}