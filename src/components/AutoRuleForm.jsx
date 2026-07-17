import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';

const METRICS = ['spend', 'clicks', 'impressions', 'reach', 'cpc', 'ctr'];

export default function AutoRuleForm({ onCreated }) {
  const [name, setName] = useState('');
  const [metric, setMetric] = useState('spend');
  const [condition, setCondition] = useState('greater_than');
  const [threshold, setThreshold] = useState('');
  const [action, setAction] = useState('pause_campaign');
  const [budget, setBudget] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await base44.entities.AutoRule.create({
        name,
        metric,
        condition,
        threshold: parseFloat(threshold),
        action,
        budget_value: action === 'set_budget' ? parseFloat(budget) : null,
        status: 'active',
      });
      setName('');
      setThreshold('');
      setBudget('');
      onCreated && onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New Rule</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="col-span-2 md:col-span-3 space-y-1.5">
            <Label>Rule name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Pause high-spend campaigns"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Metric</Label>
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Condition</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="greater_than">Greater than</SelectItem>
                <SelectItem value="less_than">Less than</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Threshold</Label>
            <Input
              type="number"
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pause_campaign">Pause campaign</SelectItem>
                <SelectItem value="set_budget">Set daily budget</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {action === 'set_budget' && (
            <div className="space-y-1.5 col-span-2">
              <Label>New daily budget ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                required
              />
            </div>
          )}
          <div className="col-span-2 md:col-span-3 flex justify-end">
            <Button type="submit" disabled={saving}>
              <Plus className="h-4 w-4 mr-2" />
              {saving ? 'Creating…' : 'Create rule'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}