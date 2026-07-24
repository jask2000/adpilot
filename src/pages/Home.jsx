import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Megaphone } from 'lucide-react';
import AccountPicker from '@/components/AccountPicker';
import CampaignRow from '@/components/CampaignRow';
import PerformanceAnalysis from '@/components/PerformanceAnalysis';
import SpendCapControl from '@/components/SpendCapControl';
import AccountInfo from '@/components/AccountInfo';

export default function Home() {
  const [accounts, setAccounts] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [campaigns, setCampaigns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await base44.functions.invoke('metaAds', { action: 'list_accounts' });
      const accs = res.data.accounts || [];
      setAccounts(accs);
      const cfgs = await base44.entities.AppConfig.list();
      const saved = cfgs[0]?.selected_ad_account_id;
      if (saved && accs.some((a) => a.account_id === saved)) setAccountId(saved);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCampaigns = useCallback(async () => {
    if (!accountId) return;
    setCampaigns(null);
    try {
      const res = await base44.functions.invoke('metaAds', {
        action: 'list_campaigns',
        account_id: accountId,
      });
      setCampaigns(res.data.campaigns || []);
    } catch {
      setCampaigns([]);
    }
  }, [accountId]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const selectAccount = async (id) => {
    setAccountId(id);
    const cfgs = await base44.entities.AppConfig.list();
    const acc = accounts.find((a) => a.account_id === id);
    const payload = {
      selected_ad_account_id: id,
      selected_ad_account_name: acc?.name,
    };
    if (cfgs[0]) await base44.entities.AppConfig.update(cfgs[0].id, payload);
    else await base44.entities.AppConfig.create(payload);
  };

  const toggle = async (c) => {
    setBusyId(c.id);
    const next = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await base44.functions.invoke('metaAds', {
        action: 'update_status',
        campaign_id: c.id,
        status: next,
      });
      setCampaigns((cs) =>
        (cs || []).map((x) => (x.id === c.id ? { ...x, status: next } : x))
      );
    } finally {
      setBusyId(null);
    }
  };

  const setBudget = async (c, dollars) => {
    setBusyId(c.id);
    try {
      await base44.functions.invoke('metaAds', {
        action: 'update_budget',
        campaign_id: c.id,
        daily_budget: Math.round(dollars * 100),
      });
      setCampaigns((cs) =>
        (cs || []).map((x) =>
          x.id === c.id ? { ...x, daily_budget: Math.round(dollars * 100) } : x
        )
      );
    } finally {
      setBusyId(null);
    }
  };

  const editCampaign = async (c, newName) => {
    setBusyId(c.id);
    try {
      await base44.functions.invoke('metaAds', {
        action: 'update_campaign',
        campaign_id: c.id,
        name: newName,
      });
      setCampaigns((cs) =>
        (cs || []).map((x) => (x.id === c.id ? { ...x, name: newName } : x))
      );
    } finally {
      setBusyId(null);
    }
  };

  const copyCampaign = async (c) => {
    setBusyId(c.id);
    try {
      await base44.functions.invoke('metaAds', {
        action: 'copy_campaign',
        campaign_id: c.id,
      });
      fetchCampaigns();
    } finally {
      setBusyId(null);
    }
  };

  const deleteCampaign = async (c) => {
    setBusyId(c.id);
    try {
      await base44.functions.invoke('metaAds', {
        action: 'delete_campaign',
        campaign_id: c.id,
      });
      setCampaigns((cs) => (cs || []).filter((x) => x.id !== c.id));
    } finally {
      setBusyId(null);
    }
  };

  const totalSpend = (campaigns || []).reduce(
    (s, c) => s + (c.insights && c.insights.spend ? parseFloat(c.insights.spend) : 0),
    0
  );
  const activeCount = (campaigns || []).filter((c) => c.status === 'ACTIVE').length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
            <Megaphone className="h-6 w-6" />
            Campaign Dashboard
          </h1>
          <p className="text-muted-foreground text-sm">
            View and control your Meta ad campaigns in real time.
          </p>
        </div>
        <Button variant="outline" onClick={fetchCampaigns} disabled={!accountId}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading ad accounts…</p>
      ) : !accounts || accounts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No ad accounts found connected to your Facebook account.
          </CardContent>
        </Card>
      ) : (
        <AccountPicker accounts={accounts} selected={accountId} onSelect={selectAccount} />
      )}

      {accountId && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="py-4">
                <p className="text-sm text-muted-foreground">Total campaigns</p>
                <p className="text-2xl font-heading">{campaigns ? campaigns.length : '—'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-heading text-green-600">
                  {campaigns ? activeCount : '—'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-sm text-muted-foreground">Total spend</p>
                <p className="text-2xl font-heading">${campaigns ? totalSpend.toFixed(2) : '—'}</p>
              </CardContent>
            </Card>
          </div>

          <AccountInfo account={accounts.find((a) => a.account_id === accountId)} />
          <SpendCapControl accountId={accountId} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Campaigns</CardTitle>
            </CardHeader>
            <CardContent>
              {campaigns === null ? (
                <p className="text-muted-foreground text-sm py-6 text-center">
                  Loading campaigns…
                </p>
              ) : campaigns.length === 0 ? (
                <p className="text-muted-foreground text-sm py-6 text-center">
                  No campaigns in this account.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Objective</TableHead>
                      <TableHead>Spend</TableHead>
                      <TableHead>Clicks</TableHead>
                      <TableHead>CTR</TableHead>
                      <TableHead>Daily budget</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((c) => (
                      <CampaignRow
                        key={c.id}
                        campaign={c}
                        accountId={accountId}
                        busy={busyId === c.id}
                        onToggle={toggle}
                        onBudget={setBudget}
                        onEdit={editCampaign}
                        onCopy={copyCampaign}
                        onDelete={deleteCampaign}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <PerformanceAnalysis campaigns={campaigns} />
        </>
      )}
    </div>
  );
}