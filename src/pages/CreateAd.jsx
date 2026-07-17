import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import CreateAdForm from '@/components/CreateAdForm';

export default function CreateAd() {
  const [accounts, setAccounts] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke('metaAds', { action: 'list_accounts' });
        setAccounts(res.data.accounts || []);
        const configs = await base44.entities.AppConfig.list();
        setConfig(configs[0] || null);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selected = (() => {
    if (!accounts || !config) return null;
    return (
      accounts.find(
        (a) => String(a.account_id) === String(config.selected_ad_account_id)
      ) ||
      accounts[0] ||
      null
    );
  })();

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (error) return <div className="p-8 text-destructive">{error}</div>;
  if (!accounts || accounts.length === 0)
    return <div className="p-8 text-muted-foreground">No ad accounts found.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create Ad</h1>
        <p className="text-muted-foreground text-sm">
          Build a new campaign with media, published paused to your account.
        </p>
        {selected && (
          <p className="text-xs text-muted-foreground mt-1">
            Account: {selected.name} ({selected.account_id})
          </p>
        )}
      </div>
      <CreateAdForm account={selected} />
    </div>
  );
}