import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, MapPin, Trash2, Pencil, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import LocationFormDialog from '@/components/LocationFormDialog';

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const locs = await base44.entities.Location.list();
        setLocations(locs);
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDelete = async (loc) => {
    if (!confirm(`Delete "${loc.name}"? This removes it as a targetable audience.`)) return;
    try {
      await base44.entities.Location.delete(loc.id);
      setLocations((prev) => prev.filter((l) => l.id !== loc.id));
    } catch (e) {
      alert('Failed to delete location: ' + (e.message || 'Unknown error'));
    }
  };

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (loc) => { setEditing(loc); setDialogOpen(true); };

  const handleSave = async (form) => {
    if (editing) {
      const updated = await base44.entities.Location.update(editing.id, form);
      setLocations((prev) => prev.map((l) => (l.id === editing.id ? { ...l, ...updated } : l)));
    } else {
      const created = await base44.entities.Location.create(form);
      setLocations((prev) => [...prev, created]);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
            <MapPin className="h-6 w-6" /> HellCrust Locations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {locations.length} store locations imported from hellcrustpizza.com — each is its own targetable audience.
            Pick the ones you want on the Quick Sales page to build a geo-targeted ad.
          </p>
        </div>
        <Button onClick={openAdd} className="shrink-0">
          <Plus className="h-4 w-4" /> Add location
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading locations…
        </div>
      ) : locations.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">No locations imported yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((l) => (
            <Card key={l.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <MapPin className="h-4 w-4" />
                  </span>
                  {l.name}
                </CardTitle>
                <CardDescription className="text-xs">
                  {l.city}, {l.province} · {l.country}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {l.address && <p className="text-sm text-muted-foreground">{l.address}</p>}
                {l.postal_code && <p className="text-xs text-muted-foreground mt-1">{l.postal_code}</p>}
                <div className="mt-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-medium">
                    Audience ready
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(l)}
                      title="Edit location"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(l)}
                      title="Delete location"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <LocationFormDialog
        open={dialogOpen}
        initial={editing}
        mode={editing ? 'edit' : 'add'}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}