import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Trash2, Zap, Bot } from 'lucide-react';
import AutoRuleForm from '@/components/AutoRuleForm';

export default function AutoRules() {
  const [rules, setRules] = useState(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);

  const fetchRules = useCallback(async () => {
    try {
      const r = await base44.entities.AutoRule.list();
      setRules(r);
    } catch {
      setRules([]);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const toggleStatus = async (rule) => {
    const next = rule.status === 'active' ? 'paused' : 'active';
    await base44.entities.AutoRule.update(rule.id, { status: next });
    fetchRules();
  };

  const remove = async (rule) => {
    await base44.entities.AutoRule.delete(rule.id);
    fetchRules();
  };

  const runNow = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await base44.functions.invoke('runAutoRules', {});
      setRunResult(res.data);
    } catch (e) {
      setRunResult({ error: e.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
            <Bot className="h-6 w-6" />
            Automation Rules
          </h1>
          <p className="text-muted-foreground text-sm">
            Conditions that run automatically every hour. Run now to test immediately.
          </p>
        </div>
        <Button onClick={runNow} disabled={running}>
          <Zap className="h-4 w-4 mr-2" />
          {running ? 'Running…' : 'Run now'}
        </Button>
      </div>

      {runResult && (
        <Card>
          <CardContent className="pt-4 text-sm">
            {runResult.error ? (
              <p className="text-destructive">{runResult.error}</p>
            ) : runResult.applied === 0 ? (
              <p className="text-muted-foreground">
                {runResult.message || 'No rules matched right now.'}
              </p>
            ) : (
              <div>
                <p className="font-medium mb-2">{runResult.applied} action(s) applied:</p>
                <ul className="list-disc pl-5 space-y-1">
                  {runResult.results.map((r, i) => (
                    <li key={i}>
                      {r.rule} → {r.action} on <b>{r.campaign}</b>
                      {r.budget ? ` ($${r.budget})` : ''}
                      {r.error ? ` — error: ${r.error}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AutoRuleForm onCreated={fetchRules} />

      <div className="space-y-3">
        {rules === null ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No rules yet. Create your first one above.
          </p>
        ) : (
          rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{rule.name}</span>
                    <Badge variant={rule.status === 'active' ? 'default' : 'secondary'}>
                      {rule.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    If <span className="font-medium">{rule.metric}</span>{' '}
                    {rule.condition === 'greater_than' ? '>' : '<'} {rule.threshold} →{' '}
                    {rule.action === 'pause_campaign'
                      ? 'pause campaign'
                      : `set budget to $${rule.budget_value || 0}`}
                  </p>
                  {rule.last_run_date && (
                    <p className="text-xs text-muted-foreground">
                      Last run: {new Date(rule.last_run_date).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Switch
                    checked={rule.status === 'active'}
                    onCheckedChange={() => toggleStatus(rule)}
                  />
                  <Button size="icon" variant="ghost" onClick={() => remove(rule)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}