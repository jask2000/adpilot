import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { Loader2, Upload, CheckCircle2, AlertCircle, Video } from 'lucide-react';
import MultiAssetUploader from '@/components/MultiAssetUploader';

const OBJECTIVES = [
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement' },
  { value: 'OUTCOME_SALES', label: 'Sales' },
];

const CTA_TYPES = [
  'ORDER_NOW',
  'SHOP_NOW',
  'LEARN_MORE',
  'SIGN_UP',
  'SUBSCRIBE',
  'CONTACT_US',
  'BOOK_NOW',
  'DOWNLOAD',
  'GET_QUOTE',
  'CALL_NOW',
];

export default function CreateAdForm({ account }) {
  const [form, setForm] = useState({
    campaign_name: '',
    objective: 'OUTCOME_TRAFFIC',
    daily_budget: '',
    ad_name: '',
    headline: '',
    message: '',
    link: '',
    cta: 'LEARN_MORE',
  });
  const [assets, setAssets] = useState([]);
  const [audiences, setAudiences] = useState([]);
  const [audienceId, setAudienceId] = useState('');
  const [audienceKind, setAudienceKind] = useState('');
  const [storeLocations, setStoreLocations] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [radius, setRadius] = useState('4');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!account) return;
    (async () => {
      try {
        const locs = await base44.entities.Location.list();
        setStoreLocations(locs || []);
      } catch (_e) { /* locations optional */ }
      try {
        const res = await base44.functions.invoke('metaAds', {
          action: 'list_audiences',
          account_id: account.account_id || account.id,
        });
        setAudiences(res.data.audiences || []);
      } catch (_e) {
        /* audiences optional */
      }
    })();
  }, [account]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke('metaAds', {
        action: 'create_ad_multi',
        account_id: account.account_id || account.id,
        campaign_name: form.campaign_name,
        objective: form.objective,
        daily_budget: form.daily_budget,
        ad_name: form.ad_name,
        headline: form.headline,
        message: form.message,
        link: form.link,
        call_to_action_type: form.cta,
        audience_id: audienceId || null,
        audience_kind: audienceKind || null,
        locations: selectedLocations.map((name) => {
          const loc = storeLocations.find((l) => l.name === name);
          return loc ? { address: loc.address, city: loc.city, province: loc.province, postal_code: loc.postal_code, country: loc.country, radius: parseFloat(radius) || 4 } : null;
        }).filter(Boolean),
        assets: assets.map((a) => ({ kind: a.kind, base64: a.base64, url: a.url, name: a.name, ratio: a.ratio })),
      });
      setResult(res.data || res);
    } catch (err) {
      setError(err.message || 'Failed to create ad');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create new ad</CardTitle>
        <CardDescription>
          Build a campaign with media and ad creative, published paused to your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Campaign name</Label>
              <Input
                required
                value={form.campaign_name}
                onChange={(e) => set('campaign_name', e.target.value)}
                placeholder="Summer Sale 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Objective</Label>
              <Select value={form.objective} onValueChange={(v) => set('objective', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBJECTIVES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Daily budget ($)</Label>
              <Input
                required
                type="number"
                min="1"
                step="0.01"
                value={form.daily_budget}
                onChange={(e) => set('daily_budget', e.target.value)}
                placeholder="20"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ad name</Label>
              <Input
                value={form.ad_name}
                onChange={(e) => set('ad_name', e.target.value)}
                placeholder="Summer Sale - Image Ad"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Headline</Label>
              <Input
                value={form.headline}
                onChange={(e) => set('headline', e.target.value)}
                placeholder="Save big this summer"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Call to action</Label>
              <Select value={form.cta} onValueChange={(v) => set('cta', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CTA_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Ad text</Label>
            <Textarea
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
              placeholder="Discover our summer collection..."
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Link URL</Label>
            <Input
              type="url"
              value={form.link}
              onChange={(e) => set('link', e.target.value)}
              placeholder="https://example.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Target audience (optional)</Label>
            <Select
              value={audienceId || 'none'}
              onValueChange={(v) => {
                if (v === 'none') {
                  setAudienceId('');
                  setAudienceKind('');
                  return;
                }
                setAudienceId(v);
                const a = audiences.find((x) => x.id === v);
                setAudienceKind(a?.kind || '');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="None — default geo targeting" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None — default geo targeting</SelectItem>
                {audiences.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.kind === 'saved' ? 'Saved' : a.subtype || 'Custom'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {storeLocations.length > 0 && (
            <div className="space-y-1.5">
              <Label>Target around store locations (optional)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Select stores to target a {radius || 4}-mile radius around each exact address.
                More precise than province-wide targeting.
              </p>
              <div className="flex items-center gap-2 mb-2">
                <Label className="text-xs">Radius (miles)</Label>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  className="w-20"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {storeLocations.map((loc) => {
                  const selected = selectedLocations.includes(loc.name);
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => {
                        setSelectedLocations((prev) =>
                          prev.includes(loc.name)
                            ? prev.filter((n) => n !== loc.name)
                            : [...prev, loc.name]
                        );
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background hover:bg-accent'
                      }`}
                    >
                      {loc.name}
                      <span className="text-xs opacity-70">
                        {loc.city}, {loc.province}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <MultiAssetUploader assets={assets} onAssets={setAssets} />

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
          {result && (
            <div className="flex items-start gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div>Ad created (paused). Campaign ID: {result.campaign_id}</div>
                <div className="text-xs text-muted-foreground">
                  Ad Set: {result.adset_id} · Ad: {result.ad_id}
                </div>
              </div>
            </div>
          )}

          <Button type="submit" disabled={loading || !account || assets.length === 0}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              'Create ad'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}