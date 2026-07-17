import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Loader2, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function PerformanceAnalysis({ campaigns }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const rows = (campaigns || [])
        .map((c) => {
          const ins = c.insights || {};
          const spend = ins.spend ? parseFloat(ins.spend).toFixed(2) : '0';
          const cpc = ins.cpc ? parseFloat(ins.cpc).toFixed(2) : '0';
          const ctr = ins.ctr ? parseFloat(ins.ctr).toFixed(2) : '0';
          return `- ${c.name} [${c.status}]: spend $${spend}, clicks ${ins.clicks || 0}, impressions ${ins.impressions || 0}, reach ${ins.reach || 0}, CTR ${ctr}%, CPC $${cpc}`;
        })
        .join('\n');

      const prompt =
        'You are a Facebook/Meta Ads performance analyst. Analyze the following ad campaigns and tell the user how each is performing. ' +
        'Flag underperformers (high spend with low CTR/results, high CPC), highlight top performers, and give concrete actionable recommendations ' +
        '(pause, adjust budget, refine targeting/creative). Be concise, structured with short sections, and actionable.\n\n' +
        'Campaigns:\n' +
        (rows || 'No campaign data available.');

      const res = await base44.integrations.Core.InvokeLLM({ prompt });
      const text =
        typeof res === 'string'
          ? res
          : res?.output || res?.data || (res?.response ? res.response : JSON.stringify(res));
      setAnalysis(text);
    } catch (e) {
      setError(e.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Performance Analysis</CardTitle>
        </div>
        <Button size="sm" onClick={analyze} disabled={loading || !campaigns || campaigns.length === 0}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Analyze performance
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}
        {!error && !analysis && !loading && (
          <p className="text-sm text-muted-foreground">
            Click "Analyze performance" for an AI review of how your campaigns are doing.
          </p>
        )}
        {analysis && (
          <div className="prose prose-sm max-w-none text-sm">
            <ReactMarkdown>{analysis}</ReactMarkdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
}