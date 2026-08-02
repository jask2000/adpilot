import React, { useEffect, useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Loader2, Search, MapPin, X, Plus } from 'lucide-react';

export default function AudienceEditDialog({ audience, onSaved, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', ageMin: '', ageMax: '', gender: 'all' });
  const [geo, setGeo] = useState({ countries: [], cities: [], regions: [], zips: [], customLocations: [] });
  const [countryInput, setCountryInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('city');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [loadingTargeting, setLoadingTargeting] = useState(false);
  const [fullAudience, setFullAudience] = useState(null);
  const [targetingAccessible, setTargetingAccessible] = useState(true);
  const debounceRef = useRef();

  const applyTargeting = (aud) => {
    const t = aud.targeting || {};
    const g = t.geo_locations || {};
    const genders = t.genders || [];
    setForm({
      name: aud.name || '',
      description: aud.description || '',
      ageMin: t.age_min != null ? String(t.age_min) : '',
      ageMax: t.age_max != null ? String(t.age_max) : '',
      gender: genders.length === 0 || genders.length === 2 ? 'all' : genders[0] === 1 ? 'male' : 'female',
    });
    setGeo({
      countries: g.countries || [],
      cities: (g.cities || []).map((c) => ({ key: c.key, name: c.name, radius: c.radius || 25 })),
      regions: (g.regions || []).map((r) => ({ key: r.key, name: r.name })),
      zips: (g.zips || []).map((z) => ({ key: z.key, name: z.name })),
      customLocations: (g.custom_locations || []).map((l) => ({
        name: l.name || l.address_string || `${l.latitude}, ${l.longitude}`,
        latitude: l.latitude,
        longitude: l.longitude,
        radius: l.radius || 5,
        distance_unit: l.distance_unit || 'mile',
      })),
    });
  };

  useEffect(() => {
    if (!audience) return;
    setError(null);
    setResults([]);
    setSearchQuery('');
    setFullAudience(null);
    setForm({
      name: audience.name || '',
      description: audience.description || '',
      ageMin: '',
      ageMax: '',
      gender: 'all',
    });
    setGeo({ countries: [], cities: [], regions: [], zips: [], customLocations: [] });
    if (audience.kind === 'saved') {
      (async () => {
        setLoadingTargeting(true);
        try {
          const res = await base44.functions.invoke('metaAds', {
            action: 'get_audience',
            audience_id: audience.id,
          });
          const aud = res.data.audience;
          setFullAudience(aud);
          setTargetingAccessible(aud.targeting_accessible !== false);
          if (aud.targeting_accessible !== false) applyTargeting(aud);
        } catch (e) {
          setError(e.response?.data?.error || e.message);
        } finally {
          setLoadingTargeting(false);
        }
      })();
    } else {
      applyTargeting(audience);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  const runSearch = async (q, type) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await base44.functions.invoke('metaAds', {
        action: 'search_locations',
        q: q.trim(),
        location_type: type,
      });
      setResults(res.data.results || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!searchQuery.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => runSearch(searchQuery, searchType), 400);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchType]);

  const addLocation = (item) => {
    const key = item.key || item.id;
    if (searchType === 'city') {
      if (geo.cities.find((c) => c.key === key)) return;
      setGeo({ ...geo, cities: [...geo.cities, { key, name: item.name, radius: 25 }] });
    } else if (searchType === 'region') {
      if (geo.regions.find((r) => r.key === key)) return;
      setGeo({ ...geo, regions: [...geo.regions, { key, name: item.name }] });
    } else if (searchType === 'zip') {
      if (geo.zips.find((z) => z.key === key)) return;
      setGeo({ ...geo, zips: [...geo.zips, { key, name: item.name }] });
    }
    setSearchQuery('');
    setResults([]);
  };

  const removeLocation = (type, key) => {
    if (type === 'country') setGeo({ ...geo, countries: geo.countries.filter((c) => c !== key) });
    else if (type === 'city') setGeo({ ...geo, cities: geo.cities.filter((c) => c.key !== key) });
    else if (type === 'region') setGeo({ ...geo, regions: geo.regions.filter((r) => r.key !== key) });
    else if (type === 'zip') setGeo({ ...geo, zips: geo.zips.filter((z) => z.key !== key) });
    else if (type === 'custom') setGeo({ ...geo, customLocations: geo.customLocations.filter((_, i) => i !== key) });
  };

  const updateCityRadius = (key, radius) => {
    setGeo({
      ...geo,
      cities: geo.cities.map((c) => (c.key === key ? { ...c, radius: Math.max(1, parseInt(radius) || 25) } : c)),
    });
  };

  const addCountry = () => {
    const c = countryInput.trim().toUpperCase();
    if (c && !geo.countries.includes(c)) setGeo({ ...geo, countries: [...geo.countries, c] });
    setCountryInput('');
  };

  const updateCustomRadius = (index, radius) => {
    setGeo({
      ...geo,
      customLocations: geo.customLocations.map((l, i) => (i === index ? { ...l, radius: Math.max(1, parseInt(radius) || 5) } : l)),
    });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        action: 'update_audience',
        audience_id: audience.id,
        name: form.name,
        description: form.description,
      };
      if (audience.kind === 'saved' && fullAudience?.targeting) {
        const t = { ...fullAudience.targeting };
        const gl = { ...(t.geo_locations || {}) };
        if (geo.countries.length) gl.countries = geo.countries; else delete gl.countries;
        if (geo.cities.length) gl.cities = geo.cities.map((c) => ({ key: c.key, name: c.name, radius: c.radius, distance_unit: 'kilometer' })); else delete gl.cities;
        if (geo.regions.length) gl.regions = geo.regions; else delete gl.regions;
        if (geo.zips.length) gl.zips = geo.zips; else delete gl.zips;
        if (geo.customLocations.length) gl.custom_locations = geo.customLocations.map((l) => ({
          latitude: l.latitude, longitude: l.longitude, radius: l.radius, distance_unit: l.distance_unit || 'mile', name: l.name,
        })); else delete gl.custom_locations;
        t.geo_locations = gl;
        if (form.ageMin) t.age_min = parseInt(form.ageMin, 10); else delete t.age_min;
        if (form.ageMax) t.age_max = parseInt(form.ageMax, 10); else delete t.age_max;
        t.genders = form.gender === 'all' ? [] : [form.gender === 'male' ? 1 : 2];
        payload.targeting = t;
      }
      await base44.functions.invoke('metaAds', payload);
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!audience) return null;
  const isSaved = audience.kind === 'saved';

  return (
    <Dialog open={!!audience} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit audience</DialogTitle>
          <DialogDescription>
            Update name, description{isSaved && targetingAccessible ? ', and targeting' : ''} for this {audience.subtype} audience.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>

          {isSaved && !targetingAccessible && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-medium">Targeting editing unavailable</p>
              <p className="mt-1 text-amber-700">
                Reading a saved audience's targeting requires Meta Marketing API Standard Access,
                which isn't enabled for this app. You can still edit the name and description below.
              </p>
            </div>
          )}

          {isSaved && targetingAccessible && (
            <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Location targeting
                {loadingTargeting && (
                  <span className="ml-2 inline-flex items-center gap-1 normal-case text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading current targeting…
                  </span>
                )}
              </p>

              <div className="space-y-1.5">
                <Label>Countries</Label>
                <div className="flex gap-2">
                  <Input
                    value={countryInput}
                    onChange={(e) => setCountryInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCountry(); } }}
                    placeholder="Add country code (e.g. CA)"
                    className="max-w-[220px]"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addCountry}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {geo.countries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {geo.countries.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs">
                        {c}
                        <button type="button" onClick={() => removeLocation('country', c)} className="hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label>Search cities, regions, or zip codes</Label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={`Search ${searchType}s…`}
                        className="pl-8"
                      />
                    </div>
                  </div>
                  <Select value={searchType} onValueChange={(v) => { setSearchType(v); setResults([]); }}>
                    <SelectTrigger className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="city">Cities</SelectItem>
                      <SelectItem value="region">Regions</SelectItem>
                      <SelectItem value="zip">Zip codes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {searching && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                  </p>
                )}

                {results.length > 0 && (
                  <div className="rounded-md border max-h-44 overflow-y-auto">
                    {results.map((r) => (
                      <button
                        key={r.key || r.id}
                        type="button"
                        onClick={() => addLocation(r)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent border-b last:border-0"
                      >
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{r.name}</span>
                        {r.country_code && <span className="text-xs text-muted-foreground shrink-0">{r.country_code}</span>}
                        <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {(geo.cities.length > 0 || geo.regions.length > 0 || geo.zips.length > 0 || geo.customLocations.length > 0) && (
                <div className="space-y-2">
                  <Label className="text-xs">Selected locations</Label>
                  <div className="space-y-1.5">
                    {geo.cities.map((c) => (
                      <div key={c.key} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                        <span className="flex items-center gap-1.5 truncate">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {c.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <Input
                            type="number"
                            min="1"
                            max="100"
                            value={c.radius}
                            onChange={(e) => updateCityRadius(c.key, e.target.value)}
                            className="w-20 h-7 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">km</span>
                          <button type="button" onClick={() => removeLocation('city', c.key)} className="hover:text-destructive">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {geo.regions.map((r) => (
                      <div key={r.key} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                        <span className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {r.name}
                        </span>
                        <button type="button" onClick={() => removeLocation('region', r.key)} className="hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {geo.zips.map((z) => (
                      <div key={z.key} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                        <span className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {z.name}
                        </span>
                        <button type="button" onClick={() => removeLocation('zip', z.key)} className="hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {geo.customLocations.map((l, i) => (
                      <div key={`custom-${i}`} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                        <span className="flex items-center gap-1.5 truncate">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {l.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <Input
                            type="number"
                            min="1"
                            max="100"
                            value={l.radius}
                            onChange={(e) => updateCustomRadius(i, e.target.value)}
                            className="w-20 h-7 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">{l.distance_unit}</span>
                          <button type="button" onClick={() => removeLocation('custom', i)} className="hover:text-destructive">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Min age</Label>
                  <Input type="number" min="13" max="65" value={form.ageMin} onChange={(e) => setForm({ ...form, ageMin: e.target.value })} placeholder="18" />
                </div>
                <div className="space-y-1.5">
                  <Label>Max age</Label>
                  <Input type="number" min="13" max="65" value={form.ageMax} onChange={(e) => setForm({ ...form, ageMax: e.target.value })} placeholder="65" />
                </div>
                <div className="space-y-1.5">
                  <Label>Gender</Label>
                  <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || loadingTargeting}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}