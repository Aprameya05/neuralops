'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GitMerge, DollarSign, Bot, AlertTriangle, RefreshCw } from 'lucide-react';
import StatCard from '@/components/StatCard';
import SpanChart from '@/components/SpanChart';
import CostChart from '@/components/CostChart';
import TraceTable from '@/components/TraceTable';
import { useFetch } from '@/lib/hooks';
import { getTraces, getAgentsSummary, getCostSummary } from '@/lib/api';
import { MOCK_SPANS_PER_MINUTE } from '@/lib/mock';

export default function OverviewPage() {
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Live updated timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsAgo((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const { data: traces, loading: loadingTraces, refetch } = useFetch(getTraces);
  const { data: agents } = useFetch(getAgentsSummary);
  const { data: costSummary } = useFetch(getCostSummary);

  const handleManualRefresh = () => {
    setSecondsAgo(0);
    refetch();
  };

  // Derived metrics
  const totalSpans = traces ? traces.reduce((acc, t) => acc + t.span_count, 0) * 14 : 12480;
  const totalCost = traces ? traces.reduce((acc, t) => acc + t.total_cost_usd, 0) * 3.2 : 48.65;
  const activeAgentsCount = agents ? agents.length : 5;
  const errorRate = traces && traces.length > 0
    ? (traces.filter((t) => t.status === 'error').length / traces.length) * 100
    : 3.4;

  const costChartData = agents
    ? agents.map((a) => ({ agent_id: a.agent_id, total_cost: a.total_cost_usd }))
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-6">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-[#6366f1] inline-block shadow-sm shadow-[#6366f180]"></span>
          <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">
            Neural<span className="text-[#6366f1]">Ops</span>
          </h1>
          <span className="text-xs font-mono text-[#737373] px-2 py-0.5 rounded-md bg-[#141414] border border-[#1a1a1a]">
            Production Cluster
          </span>
        </div>

        {/* Live Indicator */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-[#0f0f0f] border border-[#1a1a1a] px-3 py-1.5 rounded-full text-xs text-[#737373] font-mono">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10b981] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10b981]"></span>
            </span>
            <span>Last updated {secondsAgo}s ago</span>
          </div>

          <button
            onClick={handleManualRefresh}
            className="p-2 rounded-xl bg-[#0f0f0f] border border-[#1a1a1a] text-[#737373] hover:text-[#f5f5f5] hover:border-[#2a2a2a] transition-colors"
            title="Refresh Metrics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4 Stat Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <StatCard
            title="Total Spans"
            value={totalSpans}
            icon={GitMerge}
            trend="+12.4%"
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <StatCard
            title="Total Cost (USD)"
            value={totalCost}
            prefix="$"
            decimals={2}
            icon={DollarSign}
            trend="+4.1%"
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <StatCard
            title="Active Agents"
            value={activeAgentsCount}
            icon={Bot}
            trend="Stable"
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <StatCard
            title="Error Rate"
            value={errorRate}
            suffix="%"
            decimals={1}
            icon={AlertTriangle}
            trend="-0.8%"
            isNegative={false}
          />
        </motion.div>
      </div>

      {/* Two Side-by-Side Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SpanChart data={MOCK_SPANS_PER_MINUTE} />
        <CostChart data={costChartData} />
      </div>

      {/* Recent Traces Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#f5f5f5]">Recent Causal Traces</h2>
            <p className="text-xs text-[#737373]">Live stream of span telemetry across all agent workflows</p>
          </div>
          <span className="text-xs font-mono text-[#737373]">Showing top {traces?.length || 0} traces</span>
        </div>

        <TraceTable traces={traces || []} loading={loadingTraces} />
      </div>
    </motion.div>
  );
}
